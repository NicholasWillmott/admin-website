/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { readCategoriesData } from "../../routes/create.ts";
import { readLocks } from "../../routes/servers.ts";
import { getDropletIp, isSafeParam } from "../../lib/utils.ts";
import { executeCommand, isCommandAllowed } from "../../ssh.ts";
import {
  errText,
  fetchFleetEndpoint,
  fetchInstanceJson,
  fetchServersJson,
  okJson,
  okText,
  runTool,
  ToolFailure,
} from "./helpers.ts";

// Fleet status tools. get_fleet_overview is the connector's entry point (the
// instructions direct the model to call it first): it is cheap — registry +
// two local files, no fan-out — and it is the only source of server_id values.

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
    runTool(async () => {
      const tagPrefix = type === "central" ? "wb-fastr-central-v" : "wb-fastr-server-v";
      const command = `docker images --format "{{.Tag}}" timroberton/comb`;
      if (!isCommandAllowed(command)) {
        return errText("Command not allowed.");
      }
      const result = await executeCommand(getDropletIp(), command);
      if (!result.success) {
        throw new ToolFailure(`docker images failed: ${result.stderr}`);
      }
      const tags = result.stdout
        .split("\n")
        .filter((tag) => tag.startsWith(tagPrefix))
        .map((tag) => tag.replace(tagPrefix, ""));
      // Same ordering as routes/docker.ts /versions: semver desc, then
      // ad-hoc tags in docker's newest-first listing order
      const isSemver = (tag: string) => /^\d+\.\d+\.\d+/.test(tag);
      const semverTags = tags.filter(isSemver).sort((a, b) => {
        const aParts = a.split(".").map(Number);
        const bParts = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if (bParts[i] !== aParts[i]) return bParts[i] - aParts[i];
        }
        return 0;
      });
      return okJson({ versions: [...semverTags, ...tags.filter((t) => !isSemver(t))] });
    }));
}
