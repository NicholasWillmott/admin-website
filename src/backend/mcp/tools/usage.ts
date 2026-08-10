/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  fetchFleetEndpoint,
  fetchInstanceJson,
  fetchServersJson,
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

///////////////////////////////////////////////////////////////////////////////
// AI cost estimation — same pricing source and formula as the admin UI
// (src/frontend/services.ts fetchModelPricing + AiUsageView computeCost)
///////////////////////////////////////////////////////////////////////////////

interface AiUsageRow {
  timestamp: string;
  user_email: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

interface ModelPricing {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
}

const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const PRICING_TTL_MS = 60 * 60 * 1000;
let pricingCache: { data: Record<string, ModelPricing>; fetchedAt: number } | null = null;

// Failure degrades to {} (costs report 0 with a note) rather than failing the
// whole tool — the token counts are still the useful part.
async function fetchModelPricing(): Promise<Record<string, ModelPricing>> {
  if (pricingCache && Date.now() - pricingCache.fetchedAt < PRICING_TTL_MS) {
    return pricingCache.data;
  }
  try {
    const response = await fetch(LITELLM_PRICING_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return {};
    const data = await response.json();
    pricingCache = { data, fetchedAt: Date.now() };
    return data;
  } catch {
    return {};
  }
}

function computeCost(log: AiUsageRow, pricing: Record<string, ModelPricing>): number {
  const p = pricing[log.model];
  if (!p) return 0;
  return (log.input_tokens * (p.input_cost_per_token ?? 0)) +
    (log.output_tokens * (p.output_cost_per_token ?? 0)) +
    (log.cache_creation_input_tokens * (p.cache_creation_input_token_cost ?? 0)) +
    (log.cache_read_input_tokens * (p.cache_read_input_token_cost ?? 0));
}

interface MonthTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  byModel: Record<string, number>;
}

const emptyMonthTotals = (): MonthTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  byModel: {},
});

const round2 = (n: number): number => Math.round(n * 100) / 100;

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

  server.registerTool("get_user_footprint", {
    title: "User fleet footprint",
    description:
      "One user's presence across the whole fleet, by email: which instances they are registered on and their activity on each (active-day counts, first/last active). Answers 'where does this person actually work?'.",
    inputSchema: z.object({ email: z.string() }),
    annotations: { readOnlyHint: true },
  }, ({ email }) =>
    runTool(async () => {
      const target = email.trim().toLowerCase();
      const servers = await fetchServersJson();
      // Two fan-outs in parallel: health_check tells us where the account
      // EXISTS (serverUsers), user_activity where it has actually been USED —
      // a zero-activity account shows up only in the first.
      const [healthByServer, activityEntries] = await Promise.all([
        fetchFleetEndpoint("health_check"),
        Promise.all(servers.map(async (s) => {
          try {
            const raw = await fetchInstanceJson(s.id, "user_activity", { email: target });
            return [s.id, raw as { activeDays?: string[] }] as const;
          } catch {
            return [s.id, null] as const;
          }
        })),
      ]);
      const activityByServer = new Map(activityEntries);
      const foundOn: Record<string, unknown> = {};
      const unreachable: string[] = [];
      for (const s of servers) {
        const health = healthByServer[s.id] as { serverUsers?: string[] } | null;
        const activity = activityByServer.get(s.id) ?? null;
        if (health === null && activity === null) {
          unreachable.push(s.id);
          continue;
        }
        const registered = health?.serverUsers
          ? health.serverUsers.some((u) => u.toLowerCase() === target)
          : "unknown";
        const activeDays = activity?.activeDays ?? [];
        if (registered !== true && activeDays.length === 0) continue;
        const sorted = [...activeDays].sort();
        foundOn[s.id] = {
          registered,
          activeDayCount: activeDays.length,
          firstActive: sorted[0] ?? null,
          lastActive: sorted.at(-1) ?? null,
        };
      }
      return okJson({
        email: target,
        instances: foundOn,
        instanceCount: Object.keys(foundOn).length,
        unreachable: unreachable.length ? unreachable : undefined,
      });
    }));

  server.registerTool("get_ai_costs", {
    title: "AI cost roll-up",
    description:
      "AI usage aggregated per instance, per month, per model — token counts and estimated USD cost (LiteLLM public pricing, same source as the admin UI). One instance, or the whole fleet when server_id is omitted.",
    inputSchema: z.object({
      server_id: SERVER_ID_OPTIONAL,
      months: z.number().int().min(1).max(24).default(3).describe(
        "How many calendar months back to include (including the current month)",
      ),
    }),
    annotations: { readOnlyHint: true },
  }, ({ server_id, months }) =>
    runTool(async () => {
      const pricing = await fetchModelPricing();
      const byServerRaw: Record<string, unknown | null> = server_id !== undefined
        ? { [server_id]: await fetchInstanceJson(server_id, "ai_usage") }
        : await fetchFleetEndpoint("ai_usage");

      const cutoff = new Date();
      cutoff.setUTCMonth(cutoff.getUTCMonth() - (months - 1), 1);
      const cutoffKey = cutoff.toISOString().slice(0, 7);

      const byServer: Record<string, Record<string, MonthTotals>> = {};
      const unreachable: string[] = [];
      let fleetCost = 0;
      for (const [id, raw] of Object.entries(byServerRaw)) {
        if (raw === null) {
          unreachable.push(id);
          continue;
        }
        const logs = (raw as { logs?: AiUsageRow[] })?.logs ?? [];
        for (const log of logs) {
          const month = log.timestamp.slice(0, 7);
          if (month < cutoffKey) continue;
          const totals = ((byServer[id] ??= {})[month] ??= emptyMonthTotals());
          const cost = computeCost(log, pricing);
          totals.calls++;
          totals.inputTokens += log.input_tokens;
          totals.outputTokens += log.output_tokens;
          totals.cacheReadTokens += log.cache_read_input_tokens;
          totals.cacheCreationTokens += log.cache_creation_input_tokens;
          totals.costUsd = round2(totals.costUsd + cost);
          totals.byModel[log.model] = round2((totals.byModel[log.model] ?? 0) + cost);
          fleetCost += cost;
        }
      }
      return okJson({
        months,
        byServer,
        totalCostUsd: round2(fleetCost),
        note: Object.keys(pricing).length === 0
          ? "Pricing feed unavailable — token counts are correct but every cost shows 0."
          : undefined,
        unreachable: unreachable.length ? unreachable : undefined,
      });
    }));

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
