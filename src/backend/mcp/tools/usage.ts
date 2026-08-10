/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  fetchFleetEndpoint,
  fetchInstanceJson,
  okJson,
  okText,
  runTool,
  toCsv,
  truncateRows,
} from "./helpers.ts";

// Usage & activity tools — thin wrappers over the same per-instance endpoints
// the /api/servers/:id/* proxy routes forward to. Tools that take an optional
// server_id fan out across the whole fleet when it's omitted (null = that
// instance was unreachable).

const SERVER_ID_OPTIONAL = z.string().optional().describe(
  "Instance id from get_fleet_overview. Omit to fan out across the whole fleet.",
);

// user_logs_aggregate rows (one per user x endpoint x week) get big fast
// fleet-wide, so they go out as CSV with a hard row cap.
const MAX_CSV_ROWS = 2000;

interface UserLogAggregateRow {
  user_email: string;
  endpoint: string;
  endpoint_result: string;
  project_id: string | null;
  week_start: string;
  count: number;
}

// Instances answer {logs: [...]} — unwrap, tolerating a bare array in case
// the shape ever changes
function aggregateRows(raw: unknown): UserLogAggregateRow[] {
  if (Array.isArray(raw)) return raw as UserLogAggregateRow[];
  const logs = (raw as { logs?: unknown })?.logs;
  return Array.isArray(logs) ? (logs as UserLogAggregateRow[]) : [];
}

export function registerUsageTools(server: McpServer): void {
  server.registerTool("get_user_logs_aggregate", {
    title: "User activity aggregate",
    description:
      "Weekly per-user endpoint usage counts (CSV: server_id,user_email,endpoint,endpoint_result,project_id,week_start,count). One instance, or the whole fleet when server_id is omitted. Capped at 2000 rows — prefer passing server_id.",
    inputSchema: z.object({ server_id: SERVER_ID_OPTIONAL }),
    annotations: { readOnlyHint: true },
  }, ({ server_id }) =>
    runTool(async () => {
      const byServer: Record<string, unknown | null> = server_id !== undefined
        ? { [server_id]: await fetchInstanceJson(server_id, "user_logs_aggregate") }
        : await fetchFleetEndpoint("user_logs_aggregate");
      const flat: (UserLogAggregateRow & { server_id: string })[] = [];
      const unreachable: string[] = [];
      for (const [id, raw] of Object.entries(byServer)) {
        if (raw === null) {
          unreachable.push(id);
          continue;
        }
        for (const row of aggregateRows(raw)) {
          flat.push({
            server_id: id,
            user_email: row.user_email,
            endpoint: row.endpoint,
            endpoint_result: row.endpoint_result,
            project_id: row.project_id,
            week_start: row.week_start,
            count: row.count,
          });
        }
      }
      const { rows, note } = truncateRows(flat, MAX_CSV_ROWS, "server_id");
      const parts = [toCsv(rows)];
      if (note) parts.push(note);
      if (unreachable.length) parts.push(`Unreachable instances: ${unreachable.join(", ")}`);
      return okText(parts.join("\n\n"));
    }));

  server.registerTool("get_ai_usage", {
    title: "AI usage log",
    description:
      "Per-call AI usage records for one instance (timestamp, user, model, input/output/cache tokens). For totals use get_ai_weekly_usage.",
    inputSchema: z.object({ server_id: z.string() }),
    annotations: { readOnlyHint: true },
  }, ({ server_id }) =>
    runTool(async () => okJson(await fetchInstanceJson(server_id, "ai_usage"))));

  server.registerTool("get_ai_weekly_usage", {
    title: "AI weekly usage",
    description:
      "Weekly AI usage totals. One instance, or the whole fleet when server_id is omitted (null = unreachable).",
    inputSchema: z.object({ server_id: SERVER_ID_OPTIONAL }),
    annotations: { readOnlyHint: true },
  }, ({ server_id }) =>
    runTool(async () =>
      okJson(
        server_id !== undefined
          ? await fetchInstanceJson(server_id, "ai_weekly_usage")
          : await fetchFleetEndpoint("ai_weekly_usage"),
      )));

  server.registerTool("get_ai_limit_hits", {
    title: "AI limit hits",
    description:
      "Events where a user hit the AI usage limit. One instance, or the whole fleet when server_id is omitted. since filters to events on/after an ISO date (single-instance only).",
    inputSchema: z.object({
      server_id: SERVER_ID_OPTIONAL,
      since: z.string().optional().describe("ISO date, e.g. 2026-07-01"),
    }),
    annotations: { readOnlyHint: true },
  }, ({ server_id, since }) =>
    runTool(async () =>
      okJson(
        server_id !== undefined
          ? await fetchInstanceJson(server_id, "ai_limit_hits", { since })
          : await fetchFleetEndpoint("ai_limit_hits"),
      )));

  server.registerTool("get_user_activity", {
    title: "User activity trail",
    description:
      "One user's recent activity on one instance, looked up by email. Find emails via list_users or get_server_status.",
    inputSchema: z.object({ server_id: z.string(), email: z.string() }),
    annotations: { readOnlyHint: true },
  }, ({ server_id, email }) =>
    runTool(async () =>
      okJson(await fetchInstanceJson(server_id, "user_activity", { email }))));

  server.registerTool("get_pg_stat_statements", {
    title: "Postgres statement stats",
    description:
      "Slowest/heaviest SQL statements on one instance's Postgres (pg_stat_statements).",
    inputSchema: z.object({
      server_id: z.string(),
      // The instance route accepts exactly these (default total = total time)
      order_by: z.enum(["total", "mean", "max", "calls"]).optional(),
      limit: z.number().int().min(1).max(100).default(25),
      min_mean_ms: z.number().optional(),
    }),
    annotations: { readOnlyHint: true },
  }, ({ server_id, order_by, limit, min_mean_ms }) =>
    runTool(async () =>
      okJson(
        await fetchInstanceJson(server_id, "pg_stat_statements", {
          orderBy: order_by,
          limit: String(limit),
          minMeanMs: min_mean_ms !== undefined ? String(min_mean_ms) : undefined,
        }),
      )));
}
