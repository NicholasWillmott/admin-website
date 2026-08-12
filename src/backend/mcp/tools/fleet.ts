/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { readCategoriesData } from "../../routes/create.ts";
import { readLocks } from "../../routes/servers.ts";
import { H_USERS } from "../../h_users.ts";
import { parseDfOutput, parseDuOutput } from "../../routes/volumes.ts";
import { getDropletIp, isSafeParam } from "../../lib/utils.ts";
import { executeCommand, isCommandAllowed } from "../../ssh.ts";
import {
  errText,
  fetchFleetEndpoint,
  fetchInstanceJson,
  fetchServersJson,
  listImageVersions,
  mapConcurrent,
  okJson,
  okText,
  runTool,
  ToolFailure,
} from "./helpers.ts";

// Fleet status tools. get_fleet_overview is the connector's entry point (the
// instructions direct the model to call it first): it is cheap — registry +
// two local files, no fan-out — and it is the only source of server_id values.

// Fetch a container's recent logs over SSH, stdout and stderr COMBINED —
// docker logs relays the container's stderr stream (where errors go) on the
// ssh command's stderr, so searching stdout alone would miss every error.
async function fetchDockerLogs(
  serverId: string,
  tailLines: number,
): Promise<string> {
  if (!isSafeParam(serverId)) {
    throw new ToolFailure(
      `Invalid server_id "${serverId}" — take ids from get_fleet_overview.`,
    );
  }
  const command = `docker logs ${serverId} --tail ${tailLines}`;
  if (!isCommandAllowed(command)) {
    throw new ToolFailure("Command not allowed.");
  }
  const result = await executeCommand(getDropletIp(), command);
  if (!result.success) {
    throw new ToolFailure(
      `docker logs failed for "${serverId}": ${result.stderr.slice(0, 300)}`,
    );
  }
  const combined = result.stderr ? `${result.stdout}\n${result.stderr}` : result.stdout;
  // Progress spinners write ANSI cursor-control sequences into the log
  // stream; strip them so matches come back as clean text
  // deno-lint-ignore no-control-regex
  return combined.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

// User-supplied search patterns are tried as a case-insensitive regex first;
// invalid regex syntax degrades to a literal substring match instead of
// erroring, so "error(" searches for those characters rather than failing.
function buildMatcher(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

// Shape of an instance's /health_check document (subset we project; the full
// document is returned verbatim by get_server_status)
interface HealthCheck {
  running: boolean;
  serverVersion: string;
  environment: string;
  uptimeMs: number;
  language: string;
  calendar: string;
  totalUsers: number;
  projects: string[];
  hasRunningModules: boolean;
  lastUserLog: { userEmail: string; endpoint: string; timestamp: string } | null;
}

export function registerFleetTools(server: McpServer): void {
  server.registerTool("get_fleet_overview", {
    title: "Fleet overview",
    description:
      "Registry of all FASTR instances: ids, labels, deployed versions, language/calendar/country configuration, server categories, and locked servers. Call this FIRST — every server_id used by other tools comes from here. Cheap (no per-instance requests); for live health use get_fleet_status.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, () =>
    runTool(async () => {
      const [servers, categories, locks] = await Promise.all([
        fetchServersJson(),
        readCategoriesData(),
        readLocks(),
      ]);
      return okJson({
        servers: servers.map((s) => ({
          id: s.id,
          label: s.label,
          serverVersion: s.serverVersion,
          mode: s.mode ?? "server",
          language: s.portuguese ? "pt" : s.french ? "fr" : "en",
          calendar: s.ethiopian ? "ethiopian" : "gregorian",
          countryIso3: s.countryIso3 ?? null,
          openAccess: s.openAccess ?? false,
          fiscalYear: s.fiscalYear ?? "none",
        })),
        categories: categories.categories,
        lockedServers: locks,
      });
    }));

  server.registerTool("get_fleet_status", {
    title: "Fleet status",
    description:
      "Live health of every FASTR instance in one fan-out: running, version, user count, project count, uptime, last activity. An instance mapping to null was unreachable (not empty). For one instance's full health document use get_server_status.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, () =>
    runTool(async () => {
      const byServer = await fetchFleetEndpoint("health_check");
      // Projected: the full document carries user email lists and contact
      // people — bulky and PII-ish, wrong default for a 30-instance dump
      const compact = Object.fromEntries(
        Object.entries(byServer).map(([id, raw]) => {
          if (raw === null) return [id, null];
          const h = raw as HealthCheck;
          return [id, {
            running: h.running,
            serverVersion: h.serverVersion,
            environment: h.environment,
            uptimeMs: h.uptimeMs,
            language: h.language,
            calendar: h.calendar,
            totalUsers: h.totalUsers,
            projectCount: h.projects?.length ?? 0,
            hasRunningModules: h.hasRunningModules,
            lastUserLog: h.lastUserLog ?? null,
          }];
        }),
      );
      return okJson(compact);
    }));

  server.registerTool("get_server_status", {
    title: "Server status",
    description:
      "Full health_check document for one instance: users, admins, projects, datasets, contact persons, uptime. Take server_id from get_fleet_overview.",
    inputSchema: z.object({ server_id: z.string() }),
    annotations: { readOnlyHint: true },
  }, ({ server_id }) =>
    runTool(async () => okJson(await fetchInstanceJson(server_id, "health_check"))));

  server.registerTool("get_server_logs", {
    title: "Server docker logs",
    description:
      "Docker container logs for one instance (fetched over SSH from the droplet). Returns the last tail_lines lines.",
    inputSchema: z.object({
      server_id: z.string(),
      tail_lines: z.number().int().min(10).max(2000).default(200),
    }),
    annotations: { readOnlyHint: true },
  }, ({ server_id, tail_lines }) =>
    runTool(async () => {
      if (!isSafeParam(server_id)) {
        return errText(`Invalid server_id "${server_id}" — take ids from get_fleet_overview.`);
      }
      const command = `docker logs ${server_id}`;
      if (!isCommandAllowed(command)) {
        return errText("Command not allowed.");
      }
      const result = await executeCommand(getDropletIp(), command);
      if (!result.success) {
        throw new ToolFailure(`docker logs failed: ${result.stderr}`);
      }
      const lines = result.stdout.split("\n");
      const tail = lines.slice(Math.max(0, lines.length - tail_lines));
      return okText(tail.join("\n"));
    }));

  server.registerTool("get_versions", {
    title: "Available image versions",
    description:
      "FASTR docker image versions available on the droplet (semver tags sorted newest first, then ad-hoc tags). type 'server' for instance images, 'central' for the central server image.",
    inputSchema: z.object({
      type: z.enum(["server", "central"]).default("server"),
    }),
    annotations: { readOnlyHint: true },
  }, ({ type }) =>
    runTool(async () => okJson({ versions: await listImageVersions(type) })));

  server.registerTool("search_server_logs", {
    title: "Search server logs",
    description:
      "Search recent docker logs for a pattern (case-insensitive regex; plain text works too) — one instance, or the whole fleet when server_id is omitted. Returns matching lines grouped by instance.",
    inputSchema: z.object({
      pattern: z.string(),
      server_id: z.string().optional().describe(
        "Instance id from get_fleet_overview. Omit to search every instance.",
      ),
      tail_lines: z.number().int().min(100).max(10000).default(1000).describe(
        "How many recent log lines per instance to search",
      ),
      max_matches: z.number().int().min(1).max(500).default(100).describe(
        "Total matching lines to return across all instances",
      ),
    }),
    annotations: { readOnlyHint: true },
  }, ({ pattern, server_id, tail_lines, max_matches }) =>
    runTool(async () => {
      const matcher = buildMatcher(pattern);
      const targets = server_id !== undefined
        ? [server_id]
        : (await fetchServersJson()).map((s) => s.id);
      const perInstance = await mapConcurrent(targets, 8, async (id) => {
        try {
          const lines = (await fetchDockerLogs(id, tail_lines)).split("\n");
          return { id, matches: lines.filter((l) => matcher.test(l)), error: null };
        } catch (error) {
          return {
            id,
            matches: [] as string[],
            error: error instanceof ToolFailure ? error.message : String(error),
          };
        }
      });
      const sections: string[] = [];
      const capped: string[] = [];
      let shown = 0;
      let totalMatches = 0;
      for (const r of perInstance) {
        totalMatches += r.matches.length;
        if (r.matches.length === 0) continue;
        const take = r.matches.slice(0, Math.max(0, max_matches - shown));
        if (take.length === 0) {
          // Cap already spent — name the instance instead of emitting an
          // empty section, so the model knows where else to look
          capped.push(`${r.id} (${r.matches.length})`);
          continue;
        }
        shown += take.length;
        sections.push(
          `== ${r.id} (${r.matches.length} match(es) in last ${tail_lines} lines)\n${take.join("\n")}`,
        );
      }
      const failed = perInstance.filter((r) => r.error !== null);
      if (sections.length === 0) {
        sections.push(`No matches for /${pattern}/i in the last ${tail_lines} lines.`);
      }
      if (shown < totalMatches) {
        sections.push(`Showing ${shown} of ${totalMatches} matches — narrow the pattern or pass server_id.`);
      }
      if (capped.length) {
        sections.push(`Also matched (not shown): ${capped.join(", ")}`);
      }
      if (failed.length) {
        sections.push(`Could not read logs from: ${failed.map((r) => r.id).join(", ")}`);
      }
      return okText(sections.join("\n\n"));
    }));

  server.registerTool("get_error_summary", {
    title: "Server error summary",
    description:
      "Scan one instance's recent docker logs for error-like lines (error/exception/fatal/unhandled/panic) and bucket them by normalized message with counts — a fast answer to 'what is breaking on this instance?'. For raw lines or fleet-wide search use search_server_logs.",
    inputSchema: z.object({
      server_id: z.string(),
      tail_lines: z.number().int().min(100).max(20000).default(5000),
    }),
    annotations: { readOnlyHint: true },
  }, ({ server_id, tail_lines }) =>
    runTool(async () => {
      const lines = (await fetchDockerLogs(server_id, tail_lines)).split("\n");
      const errorRe = /error|exception|fatal|unhandled|panic/i;
      // Bucket by shape, not by exact text: timestamps, uuids and numbers vary
      // per occurrence, so they are collapsed before grouping
      const normalize = (line: string) =>
        line
          .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "<ts>")
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
          .replace(/\b\d+\b/g, "#")
          .trim()
          .slice(0, 160);
      const buckets = new Map<string, { count: number; example: string }>();
      let errorLines = 0;
      for (const line of lines) {
        if (!line.trim() || !errorRe.test(line)) continue;
        errorLines++;
        const key = normalize(line);
        const bucket = buckets.get(key);
        if (bucket) bucket.count++;
        else buckets.set(key, { count: 1, example: line.trim().slice(0, 300) });
      }
      const top = [...buckets.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 30)
        .map(([patternKey, b]) => ({ count: b.count, pattern: patternKey, example: b.example }));
      return okJson({
        server_id,
        linesScanned: lines.length,
        errorLines,
        distinctPatterns: buckets.size,
        topPatterns: top,
      });
    }));

  server.registerTool("get_disk_breakdown", {
    title: "Droplet disk breakdown",
    description:
      "Disk usage for every data volume on the droplet: totals (df) plus per-directory sizes (du), largest first — answers 'which instance is using the space?'.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, () =>
    runTool(async () => {
      const lsResult = await executeCommand(getDropletIp(), "ls /mnt");
      if (!lsResult.success) {
        throw new ToolFailure(`Could not list volumes: ${lsResult.stderr.slice(0, 300)}`);
      }
      const volumes = lsResult.stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
      const breakdown = await mapConcurrent(volumes, 4, async (name) => {
        const mountPath = `/mnt/${name}`;
        const dfCommand = `df -BG ${mountPath}`;
        const duCommand = `du -BG --max-depth=1 ${mountPath}`;
        if (!isCommandAllowed(dfCommand) || !isCommandAllowed(duCommand)) {
          return { name, error: "Command not allowed" };
        }
        const [dfResult, duResult] = await Promise.all([
          executeCommand(getDropletIp(), dfCommand),
          executeCommand(getDropletIp(), duCommand),
        ]);
        const df = dfResult.success ? parseDfOutput(dfResult.stdout, mountPath) : null;
        const directories = duResult.success
          ? parseDuOutput(duResult.stdout, mountPath).sort((a, b) => b.sizeGB - a.sizeGB)
          : [];
        return {
          name,
          df,
          // df is null when the path is not a dedicated mount (it sits on
          // another filesystem) — the du breakdown is still valid
          dfNote: df === null ? "not a dedicated mount — no volume-level totals" : undefined,
          directories,
        };
      });
      return okJson({ volumes: breakdown });
    }));

  server.registerTool("get_dormant_instances", {
    title: "Instances nobody is using",
    description:
      "Instances that are running and healthy but that real users have stopped signing into — the failure a status check cannot see, because a dormant instance looks identical to a busy one. Per instance: days since the last real sign-in, distinct users in the window, accounts and projects provisioned, and whether it has ever been used at all. FASTR staff are excluded from the activity signal by default, so an instance kept warm only by the team still reads as dormant. Activity is the getCurrentUser login trail, retained back to roughly 2026-04-05 only — the response reports the earliest data actually available, so a long window may be silently truncated.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(365).default(30).describe(
        "Dormant means no real user has signed in within this many days.",
      ),
      include_demo_and_testing: z.boolean().default(false).describe(
        "Include demo/testing boxes, which are expected to be quiet.",
      ),
      count_internal_staff: z.boolean().default(false).describe(
        "Count FASTR team sign-ins as real activity. Off by default — a country instance only the team logs into is not in use.",
      ),
    }),
    annotations: { readOnlyHint: true },
  }, ({ days, include_demo_and_testing, count_internal_staff }) =>
    runTool(async () => {
      const cutoff = new Date(Date.now() - days * 86_400_000)
        .toISOString().slice(0, 10);

      const [registry, locked, healthByServer] = await Promise.all([
        fetchServersJson(),
        readLocks().catch(() => [] as string[]),
        fetchFleetEndpoint("health_check"),
      ]);
      const lockedSet = new Set(locked);
      const servers = registry.filter((s) =>
        s.mode !== "central" &&
        (include_demo_and_testing ||
          !(s.id.startsWith("testing") || s.id.startsWith("demo")))
      );

      const rows = await mapConcurrent(servers, 8, async (s) => {
        const health = healthByServer[s.id] as {
          serverUsers?: string[];
          totalUsers?: number;
          projects?: unknown[];
          running?: boolean;
          serverVersion?: string;
        } | null;
        let payload: unknown = null;
        let logsReachable = true;
        try {
          payload = await fetchInstanceJson(s.id, "user_logs");
        } catch {
          logsReachable = false;
        }
        const logs = (Array.isArray(payload)
          ? payload
          : (payload as { logs?: unknown[] })?.logs ?? []) as {
            user_email?: string;
            timestamp?: string;
          }[];

        let lastSignIn: string | null = null;
        let earliest: string | null = null;
        const usersInWindow = new Set<string>();
        for (const row of logs) {
          const day = (row.timestamp ?? "").slice(0, 10);
          const email = (row.user_email ?? "").trim().toLowerCase();
          if (!day || !email) continue;
          // The team logging in to check on an instance is not the country
          // using it — that distinction is the whole point of this tool.
          if (!count_internal_staff && H_USERS.has(email)) continue;
          if (earliest === null || day < earliest) earliest = day;
          if (lastSignIn === null || day > lastSignIn) lastSignIn = day;
          if (day >= cutoff) usersInWindow.add(email);
        }

        const status = (health === null && !logsReachable)
          ? "unreachable"
          : lastSignIn === null
          ? "never_used"
          : usersInWindow.size === 0
          ? "dormant"
          : "active";

        return {
          id: s.id,
          label: s.label,
          status,
          registeredUsers: health?.serverUsers?.length ?? health?.totalUsers ?? null,
          projectCount: health?.projects?.length ?? null,
          lastRealSignIn: lastSignIn,
          daysSinceLastRealSignIn: lastSignIn === null ? null : Math.floor(
            (Date.now() - Date.parse(`${lastSignIn}T00:00:00Z`)) / 86_400_000,
          ),
          distinctUsersInWindow: usersInWindow.size,
          serverVersion: health?.serverVersion ?? s.serverVersion,
          running: health?.running ?? null,
          locked: lockedSet.has(s.id) || undefined,
          earliest,
        };
      });

      const earliestSeen = rows
        .map((r) => r.earliest)
        .filter((d): d is string => d !== null)
        .sort()[0] ?? null;
      // Impact-first: an instance with 245 provisioned users going quiet
      // matters more than one with 8, whatever the elapsed days.
      const byImpact = (a: typeof rows[number], b: typeof rows[number]) =>
        (b.registeredUsers ?? 0) - (a.registeredUsers ?? 0) ||
        (b.daysSinceLastRealSignIn ?? 0) - (a.daysSinceLastRealSignIn ?? 0);
      const pick = (status: string) =>
        rows.filter((r) => r.status === status).sort(byImpact)
          .map(({ earliest: _e, ...rest }) => rest);

      const dormant = pick("dormant");
      const neverUsed = pick("never_used");
      const unreachable = pick("unreachable");

      return okJson({
        window: {
          days,
          cutoff,
          earliestActivityAvailable: earliestSeen,
          note: earliestSeen !== null && earliestSeen > cutoff
            ? `Instances only retain sign-ins back to ${earliestSeen}, later than the ${days}-day cutoff of ${cutoff}. "Never used" here means "not since ${earliestSeen}".`
            : null,
        },
        countingInternalStaffAsActivity: count_internal_staff,
        summary: {
          examined: rows.length,
          active: rows.filter((r) => r.status === "active").length,
          dormant: dormant.length,
          neverUsed: neverUsed.length,
          unreachable: unreachable.length,
          usersOnDormantInstances: dormant.reduce(
            (n, r) => n + (r.registeredUsers ?? 0),
            0,
          ),
        },
        dormant,
        neverUsed,
        unreachable: unreachable.length ? unreachable : undefined,
      });
    }));
}
