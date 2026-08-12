/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { getDropletIp, isSafeParam } from "../../lib/utils.ts";
import { executeCommand, isCommandAllowed } from "../../ssh.ts";
import { readLocks } from "../../routes/servers.ts";
import {
  fetchServersJson,
  listImageVersions,
  okJson,
  type RegistryServer,
  runTool,
  ToolFailure,
} from "./helpers.ts";

// restart_server / start_server / stop_server / update_server — write tools
// mirroring the admin UI's per-server lifecycle buttons (ServerCard.tsx).
//
// Safety model, same two layers as create_server:
//   1. confirm:false (the default) NEVER mutates — it resolves the server,
//      runs every pre-flight check and returns a preview. confirm:true re-runs
//      the checks (state can change between calls) before the first mutation.
//   2. Neither tool carries readOnlyHint, so MCP clients treat them as writes
//      and raise their own permission prompt.
//
// TWO GUARDS HERE THAT THE HTTP ROUTES DO NOT HAVE, both deliberate:
//
//   Locks. routes/servers.ts stores server locks and serves them at GET
//   /locks, but the restart/update routes never consult them — enforcement
//   lives entirely in the UI, which disables the buttons (ServerCard.tsx:174,
//   246). A tool calling the same wb commands would therefore be the ONLY way
//   to restart a server someone deliberately locked, silently defeating the
//   marker. So the lock is enforced below, not just reported.
//
//   Serialisation. The UI holds a global sshOperationInProgress flag
//   (ServersView.tsx) because the droplet's wb commands are not safe to
//   interleave. Nothing enforces that server-side, and MCP calls can arrive
//   concurrently (a model issuing parallel calls, or two admins at once), so
//   the mutating paths take the process-wide lock below.

const RESTART_VERIFY_ATTEMPTS = 7;
const RESTART_VERIFY_INTERVAL_MS = 3_000;
const CRASH_LOG_TAIL_LINES = 20;

// Process-wide, not per-request: createMcpHandler builds a fresh McpServer per
// HTTP request, but this module is instantiated once for the process.
let sshOperationInProgress = false;

async function withSshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (sshOperationInProgress) {
    throw new ToolFailure(
      "Another restart or update is already running on the droplet. Wait for it to finish, then retry.",
    );
  }
  sshOperationInProgress = true;
  try {
    return await fn();
  } finally {
    sshOperationInProgress = false;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWb(command: string): Promise<{ success: boolean; detail: string }> {
  if (!isCommandAllowed(command)) {
    return { success: false, detail: `Command not allowed: ${command}` };
  }
  const result = await executeCommand(getDropletIp(), command);
  return {
    success: result.success,
    detail: (result.success ? result.stdout : result.stderr).trim().slice(0, 400),
  };
}

async function resolveServer(serverId: string): Promise<RegistryServer> {
  if (!isSafeParam(serverId)) {
    throw new ToolFailure(
      `Invalid server_id "${serverId}" — take ids from get_fleet_overview.`,
    );
  }
  const server = (await fetchServersJson()).find((s) => s.id === serverId);
  if (!server) {
    throw new ToolFailure(
      `No server "${serverId}" in the fleet registry — check get_fleet_overview.`,
    );
  }
  return server;
}

async function assertUnlocked(serverId: string): Promise<void> {
  if ((await readLocks()).includes(serverId)) {
    throw new ToolFailure(
      `"${serverId}" is locked. A lock is a deliberate "do not touch" marker set by an admin — ` +
        `unlock it in the admin website (Servers → the lock icon on the server card) before restarting or updating. ` +
        `Do not work around this.`,
    );
  }
}

// The central server is started rather than restarted — same branch as
// routes/servers.ts /:id/restart.
function restartCommandFor(server: RegistryServer): string {
  return server.mode === "central"
    ? `wb run-central ${server.id}`
    : `wb restart ${server.id}`;
}

// Same branch as routes/servers.ts /run
function startCommandFor(server: RegistryServer): string {
  return server.mode === "central"
    ? `wb run-central ${server.id}`
    : `wb run ${server.id}`;
}

function stopCommandFor(server: RegistryServer): string {
  return `wb stop ${server.id}`;
}

type ContainerState = { id: string; status: string; exitCode: string };

// null means docker has no such container (never started, or removed).
async function inspectContainer(serverId: string): Promise<ContainerState | null> {
  const command =
    `docker inspect -f '{{.Id}} {{.State.Status}} {{.State.ExitCode}}' ${serverId}`;
  if (!isCommandAllowed(command)) {
    throw new ToolFailure(`Command not allowed: ${command}`);
  }
  const result = await executeCommand(getDropletIp(), command);
  if (!result.success) return null;
  const [id, status, exitCode] = result.stdout.trim().split(/\s+/);
  if (!id) return null;
  return { id, status, exitCode: exitCode ?? "" };
}

async function crashLogTail(serverId: string): Promise<string> {
  const command = `docker logs ${serverId} --tail ${CRASH_LOG_TAIL_LINES}`;
  if (!isCommandAllowed(command)) return "";
  const result = await executeCommand(getDropletIp(), command);
  // docker logs relays the container's stderr, so the interesting output is
  // there even on a successful call
  return `${result.stdout}\n${result.stderr}`.trim().slice(-2000);
}

type LifecycleOutcome = {
  command: string;
  result: "running" | "stopped" | "crashed" | "unconfirmed";
  exitCode?: string;
  logsTail?: string;
  note: string;
};

const verifyWindowSeconds = (RESTART_VERIFY_ATTEMPTS * RESTART_VERIFY_INTERVAL_MS) / 1000;

// Runs a lifecycle command, then watches docker until the container actually
// reaches the expected state — reporting success purely because the wb command
// exited 0 would call a crash-on-startup a successful restart, which is exactly
// the failure an operator needs to hear about.
async function applyAndVerify(
  server: RegistryServer,
  command: string,
  expect: "running" | "stopped",
): Promise<LifecycleOutcome> {
  const before = await inspectContainer(server.id);
  const wasRunning = before?.status === "running";
  const wb = await runWb(command);
  if (!wb.success) {
    throw new ToolFailure(`"${command}" failed for "${server.id}": ${wb.detail}`);
  }

  for (let attempt = 0; attempt < RESTART_VERIFY_ATTEMPTS; attempt++) {
    await delay(RESTART_VERIFY_INTERVAL_MS);
    const now = await inspectContainer(server.id);

    if (expect === "stopped") {
      // A removed container counts as stopped — wb stop may take it away
      if (!now || now.status === "exited" || now.status === "dead" || now.status === "created") {
        return {
          command,
          result: "stopped",
          exitCode: now?.exitCode,
          note: `"${server.id}" is stopped and will stay down until it is started again.`,
        };
      }
      continue;
    }

    if (!now) continue;
    // If it was already running, only a NEW container id proves the command
    // actually cycled it rather than the old process lingering. If it was
    // stopped (or absent), simply reaching "running" is the proof.
    const proven = wasRunning ? now.id !== before!.id : true;
    if (now.status === "running" && proven) {
      return {
        command,
        result: "running",
        note: `"${server.id}" is up${wasRunning ? " on a new container" : ""}.`,
      };
    }
    if (now.status === "exited" || now.status === "dead") {
      return {
        command,
        result: "crashed",
        exitCode: now.exitCode,
        logsTail: await crashLogTail(server.id),
        note:
          `"${server.id}" started and then exited (code ${now.exitCode}). It is DOWN — ` +
          `read logsTail, and consider updating back to the previous version.`,
      };
    }
  }

  return {
    command,
    result: "unconfirmed",
    note:
      `"${command}" succeeded but "${server.id}" was not confirmed ${expect} after ${verifyWindowSeconds}s. ` +
      `It may just be slow — check get_server_status and get_server_logs before retrying, and do NOT blindly run it again.`,
  };
}

export function registerServerOpsTools(server: McpServer): void {
  server.registerTool("restart_server", {
    title: "Restart a server",
    description:
      "Restart one FASTR instance's container (wb restart; wb run-central for the central server), then verify it came back up. " +
      "confirm:false (the default) previews and changes nothing. Refuses if the instance is locked in the admin website.",
    inputSchema: z.object({
      server_id: z.string().describe("Instance id from get_fleet_overview."),
      confirm: z.boolean().default(false).describe(
        "false returns a preview and mutates nothing; true performs the restart. Only pass true after the user has explicitly approved this specific server.",
      ),
    }),
  }, ({ server_id, confirm }) =>
    runTool(async () => {
      const target = await resolveServer(server_id);
      await assertUnlocked(server_id);
      const command = restartCommandFor(target);

      if (!confirm) {
        const current = await inspectContainer(server_id);
        return okJson({
          preview: true,
          server_id,
          label: target.label,
          mode: target.mode ?? "instance",
          currentStatus: current?.status ?? "no container found",
          commandToRun: command,
          impact:
            "Restarting drops in-flight requests and any unsaved work in active user sessions on this instance.",
          next: "Call again with confirm:true to perform the restart.",
        });
      }

      const outcome = await withSshLock(() =>
        applyAndVerify(target, command, "running")
      );
      return okJson({ server_id, label: target.label, ...outcome });
    }));

  server.registerTool("start_server", {
    title: "Start a stopped server",
    description:
      "Start one FASTR instance's container (wb run; wb run-central for the central server), then verify it came up. " +
      "Use restart_server for an instance that is already running. confirm:false (the default) previews and changes nothing. " +
      "Refuses if the instance is locked in the admin website.",
    inputSchema: z.object({
      server_id: z.string().describe("Instance id from get_fleet_overview."),
      confirm: z.boolean().default(false).describe(
        "false returns a preview and mutates nothing; true starts the instance. Only pass true after the user has explicitly approved this specific server.",
      ),
    }),
  }, ({ server_id, confirm }) =>
    runTool(async () => {
      const target = await resolveServer(server_id);
      await assertUnlocked(server_id);
      const command = startCommandFor(target);
      const current = await inspectContainer(server_id);

      if (!confirm) {
        return okJson({
          preview: true,
          server_id,
          label: target.label,
          mode: target.mode ?? "instance",
          currentStatus: current?.status ?? "no container found",
          commandToRun: command,
          alreadyRunning: current?.status === "running",
          impact: current?.status === "running"
            ? "This instance is already running — starting it again will recreate the container, dropping in-flight requests. restart_server is the clearer choice."
            : "Brings the instance back online for users.",
          next: "Call again with confirm:true to start it.",
        });
      }

      const outcome = await withSshLock(() =>
        applyAndVerify(target, command, "running")
      );
      return okJson({ server_id, label: target.label, ...outcome });
    }));

  server.registerTool("stop_server", {
    title: "Stop a server",
    description:
      "Stop one FASTR instance's container (wb stop) and verify it went down. The instance stays OFFLINE for its users until start_server is called — this is not a restart. " +
      "confirm:false (the default) previews and changes nothing. Refuses if the instance is locked in the admin website.",
    inputSchema: z.object({
      server_id: z.string().describe("Instance id from get_fleet_overview."),
      confirm: z.boolean().default(false).describe(
        "false returns a preview and mutates nothing; true stops the instance. Only pass true after the user has explicitly approved taking this specific server offline.",
      ),
    }),
  }, ({ server_id, confirm }) =>
    runTool(async () => {
      const target = await resolveServer(server_id);
      await assertUnlocked(server_id);
      const command = stopCommandFor(target);
      const current = await inspectContainer(server_id);

      if (!confirm) {
        return okJson({
          preview: true,
          server_id,
          label: target.label,
          mode: target.mode ?? "instance",
          currentStatus: current?.status ?? "no container found",
          commandToRun: command,
          impact:
            `Takes "${target.label}" OFFLINE for all of its users, indefinitely. Nothing restarts it automatically — ` +
            `it stays down until start_server is called. In-flight requests and unsaved work are lost.`,
          next: "Call again with confirm:true only if the user explicitly wants this instance taken offline.",
        });
      }

      const outcome = await withSshLock(() =>
        applyAndVerify(target, command, "stopped")
      );
      return okJson({ server_id, label: target.label, ...outcome });
    }));

  server.registerTool("update_server", {
    title: "Update a server's version",
    description:
      "Point one FASTR instance at a different image version and restart it so the change takes effect — the same two steps the admin website's Update button performs (the version change alone does nothing until the container cycles). " +
      "confirm:false (the default) previews and changes nothing. Refuses if the instance is locked, or if the version is not on the droplet.",
    inputSchema: z.object({
      server_id: z.string().describe("Instance id from get_fleet_overview."),
      version: z.string().describe(
        'Bare version tag as listed by get_versions, e.g. "2.4.1" — not the full docker tag.',
      ),
      confirm: z.boolean().default(false).describe(
        "false returns a preview and mutates nothing; true performs the update and restart. Only pass true after the user has explicitly approved this specific server and version.",
      ),
    }),
  }, ({ server_id, version, confirm }) =>
    runTool(async () => {
      const target = await resolveServer(server_id);
      await assertUnlocked(server_id);
      if (!isSafeParam(version)) {
        throw new ToolFailure(
          `Invalid version "${version}" — use a tag exactly as get_versions lists it.`,
        );
      }

      // Instances and the central server draw from different image tag
      // prefixes, the same split the UI makes (ServersView.tsx:624)
      const imageType = target.mode === "central" ? "central" : "server";
      const available = await listImageVersions(imageType);
      if (!available.includes(version)) {
        throw new ToolFailure(
          `Version "${version}" is not available on the droplet for ${imageType} images. ` +
            `Available: ${available.slice(0, 15).join(", ")}${available.length > 15 ? ", …" : ""}. ` +
            `Pull it first, or pick one of these.`,
        );
      }

      const previousVersion = target.serverVersion;
      if (previousVersion === version) {
        throw new ToolFailure(
          `"${server_id}" is already on ${version}. Use restart_server if you just want to cycle the container.`,
        );
      }
      const updateCommand = `wb c update ${server_id} --server ${version}`;

      if (!confirm) {
        return okJson({
          preview: true,
          server_id,
          label: target.label,
          mode: target.mode ?? "instance",
          previousVersion,
          targetVersion: version,
          commandsToRun: [updateCommand, restartCommandFor(target)],
          impact:
            "Changes the registry version, then restarts the instance — dropping in-flight requests and any unsaved work in active user sessions.",
          rollback:
            `If the new version misbehaves, call update_server again with version "${previousVersion}".`,
          next: "Call again with confirm:true to perform the update and restart.",
        });
      }

      return await withSshLock(async () => {
        const wb = await runWb(updateCommand);
        if (!wb.success) {
          throw new ToolFailure(
            `Version update failed for "${server_id}": ${wb.detail}. The registry is unchanged and the instance was not restarted.`,
          );
        }
        // From here the registry says `version` even if the restart goes bad,
        // so the outcome must always report both halves
        const outcome = await applyAndVerify(target, restartCommandFor(target), "running");
        return okJson({
          server_id,
          label: target.label,
          previousVersion,
          version,
          versionChanged: true,
          restart: outcome,
          rollback: outcome.result === "running"
            ? undefined
            : `The registry now says ${version} but the instance is not confirmed healthy. ` +
              `To roll back, call update_server with version "${previousVersion}".`,
        });
      });
    }));
}
