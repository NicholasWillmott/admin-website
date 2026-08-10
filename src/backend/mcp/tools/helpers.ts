/// <reference lib="deno.ns" />
import type { CallToolResult } from "@modelcontextprotocol/server";
import { isSafeParam } from "../../lib/utils.ts";

// Shared plumbing for the MCP tools. The one-line fetches here deliberately
// duplicate what the Hono route handlers do inline (routes/servers.ts etc.)
// rather than refactoring those handlers — the fetches are trivial, and the
// tools need timeouts the routes never had.

// An anticipated, model-readable failure: reaches the client as a clean
// isError result with no stack trace and no console noise. Any other throw is
// treated as a bug (logged) but still returned as isError so the model can
// report it instead of the call dying as a protocol error.
export class ToolFailure extends Error {}

export function okText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function okJson(data: unknown): CallToolResult {
  return okText(JSON.stringify(data, null, 2));
}

export function errText(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export async function runTool(
  fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ToolFailure) {
      return errText(error.message);
    }
    console.error("[mcp] unexpected tool error:", error);
    return errText(`Unexpected error: ${String(error)}`);
  }
}

// Registry entry from central's servers.json. Mirrors the frontend's Server
// type (src/frontend/types.ts) — not imported because the backend is
// Deno-checked and the frontend lives in the Vite TypeScript world.
export interface RegistryServer {
  id: string;
  label: string;
  port: number;
  serverVersion: string;
  adminVersion?: string;
  french?: boolean;
  portuguese?: boolean;
  ethiopian?: boolean;
  fiscalYear?: string;
  countryIso3?: string;
  openAccess?: boolean;
  volume?: string;
  mode?: "central";
}

// An MCP tool must not hang on a dead instance: a claude.ai tool call that
// waits on a default TCP timeout looks like a broken connector.
const INSTANCE_TIMEOUT_MS = 15_000;

export async function fetchServersJson(): Promise<RegistryServer[]> {
  const response = await fetch("https://central.fastr-analytics.org/servers.json", {
    signal: AbortSignal.timeout(INSTANCE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ToolFailure(
      `Could not fetch the fleet registry (servers.json answered ${response.status}).`,
    );
  }
  return await response.json();
}

// Fetch one endpoint on one instance. Throws ToolFailure with an actionable
// message on bad ids / unreachable instances.
export async function fetchInstanceJson(
  serverId: string,
  path: string,
  params: Record<string, string | undefined> = {},
): Promise<unknown> {
  if (!isSafeParam(serverId)) {
    throw new ToolFailure(
      `Invalid server_id "${serverId}" — take ids from get_fleet_overview.`,
    );
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, v);
  }
  const tail = qs.toString() ? `?${qs.toString()}` : "";
  let response: Response;
  try {
    response = await fetch(
      `https://${serverId}.fastr-analytics.org/${path}${tail}`,
      { signal: AbortSignal.timeout(INSTANCE_TIMEOUT_MS) },
    );
  } catch (error) {
    throw new ToolFailure(
      `Instance "${serverId}" unreachable (${String(error)}). It may be stopped — check get_fleet_status.`,
    );
  }
  if (!response.ok) {
    throw new ToolFailure(
      `Instance "${serverId}" answered ${response.status} for ${path}. It may not exist — check get_fleet_overview.`,
    );
  }
  return await response.json();
}

// Fan one endpoint out across every instance in the registry. An instance
// that fails or is unreachable maps to null (same convention as the
// /api/servers/all/:endpoint route the frontend uses).
export async function fetchFleetEndpoint(
  endpoint: string,
): Promise<Record<string, unknown | null>> {
  const servers = await fetchServersJson();
  const entries = await Promise.all(servers.map(async (server) => {
    try {
      const resp = await fetch(
        `https://${server.id}.fastr-analytics.org/${endpoint}`,
        { signal: AbortSignal.timeout(INSTANCE_TIMEOUT_MS) },
      );
      if (!resp.ok) return [server.id, null] as const;
      return [server.id, await resp.json()] as const;
    } catch {
      return [server.id, null] as const;
    }
  }));
  return Object.fromEntries(entries);
}

///////////////////////////////////////////////////////////////////////////////
// Clerk Backend API (users/sessions tools want pagination pass-through, which
// the routes don't do — they fetch-all — so this is not shared with them)
///////////////////////////////////////////////////////////////////////////////

export async function fetchClerkJson(pathAndQuery: string): Promise<unknown> {
  const secretKey = Deno.env.get("CLERK_SECRET_KEY");
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY not configured");
  }
  const response = await fetch(`https://api.clerk.com/v1${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(INSTANCE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ToolFailure(`Clerk API answered ${response.status} for ${pathAndQuery.split("?")[0]}.`);
  }
  return await response.json();
}

///////////////////////////////////////////////////////////////////////////////
// Output shaping
///////////////////////////////////////////////////////////////////////////////

// Generic rows -> CSV, columns derived from the union of row keys. Values are
// quoted only when needed. Used for large tabular payloads where CSV is ~3x
// denser than pretty JSON.
export function toCsv<T extends object>(rows: T[]): string {
  if (rows.length === 0) return "";
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const escape = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    columns.join(","),
    ...rows.map((r) =>
      columns.map((col) => escape((r as Record<string, unknown>)[col])).join(",")
    ),
  ].join("\n");
}

// Bound a row set, telling the model what was dropped and how to narrow —
// silent truncation reads as "that's everything" when it isn't.
export function truncateRows<T>(
  rows: T[],
  max: number,
  narrowHint: string,
): { rows: T[]; note: string | null } {
  if (rows.length <= max) return { rows, note: null };
  return {
    rows: rows.slice(0, max),
    note: `Showing ${max} of ${rows.length} rows — narrow with ${narrowHint}.`,
  };
}
