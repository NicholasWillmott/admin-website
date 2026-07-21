/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import { isSafeParam, getServerInfo, getDropletIp } from "../lib/utils.ts";
import { executeCommand, isCommandAllowed } from "../ssh.ts";

const router = new Hono();

const LOCKS_FILE = "/mnt/fastr-config/server-locks.json";

async function readLocks(): Promise<string[]> {
  try {
    return JSON.parse(await Deno.readTextFile(LOCKS_FILE));
  } catch {
    return [];
  }
}

async function writeLocks(locks: string[]): Promise<void> {
  await Deno.mkdir("/mnt/fastr-config", { recursive: true });
  await Deno.writeTextFile(LOCKS_FILE, JSON.stringify(locks));
}

// Aggregate proxy: fetches one endpoint across every server in a single request, so the
// frontend doesn't pay auth + round-trip overhead per server. Returns the raw per-server
// JSON keyed by server id; servers that fail or are unreachable map to null.
// NOTE: registered before the /:id/* routes so "all" is never captured as a server id.
// Maps the public endpoint name to the path fetched on each target server
const AGGREGATE_ENDPOINTS = new Map([
    ["ai_usage", "ai_usage"],
    ["ai_weekly_usage", "ai_weekly_usage"],
    ["ai_limit_hits", "ai_limit_hits"],
    ["user_logs", "user_logs"],
    ["user_logs_aggregate", "user_logs_aggregate"],
    ["user_logs_all", "user_logs_all"],
    ["status", "health_check"],
]);

router.get("/all/:endpoint", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const endpoint = AGGREGATE_ENDPOINTS.get(c.req.param("endpoint"));
    if (!endpoint) {
        return c.json({ error: "Invalid endpoint" }, 400);
    }

    try {
        const response = await fetch("https://central.fastr-analytics.org/servers.json");
        const servers: { id: string }[] = await response.json();

        const entries = await Promise.all(servers.map(async (server) => {
            try {
                const resp = await fetch(`https://${server.id}.fastr-analytics.org/${endpoint}`);
                if (!resp.ok) return [server.id, null] as const;
                return [server.id, await resp.json()] as const;
            } catch {
                return [server.id, null] as const;
            }
        }));

        return c.json(Object.fromEntries(entries));
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Restart individual server
router.post("/:id/restart", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");

    if (!isSafeParam(serverId)) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    const server = await getServerInfo(serverId);
    if (!server || !server.id) {
        return c.json({ error: "Server not found" }, 404);
    }

    const command = server.mode === "central" ? `wb run-central ${serverId}` : `wb restart ${serverId}`;
    console.log(command);

    if (!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Restart bulk servers
router.post("/bulk-restart", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ ids: string[] }>();
    const ids: string[] = body.ids;

    if (!ids.every(id => isSafeParam(id))) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    const command = "wb restart " + ids.join(" ");

    if (!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

    // Don't await — wb restart runs servers sequentially and can take a long time.
    // Awaiting it causes the HTTP connection to drop ("TypeError: Failed to fetch")
    // before the command finishes. The frontend polls docker logs to detect when
    // each server comes back online, so we don't need to wait for the result here.
    executeCommand(getDropletIp(), command)
        .then(result => { if (!result.success) console.error(`Bulk restart failed: ${result.stderr}`); })
        .catch(err => console.error(`Bulk restart error: ${err}`));
    return c.json({ success: true });
});

// Reset pg_stat_statements for a server
router.post("/:id/pg_stat_statements/reset", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");

    if (!isSafeParam(serverId)) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/pg_stat_statements_reset`, { method: "POST" });
        const data = await response.json();
        return c.json(data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Per-server proxy: GET /:id/<route> forwards to https://<id>.fastr-analytics.org/<targetPath>,
// passing through only the listed query params (and only when non-empty).
function proxyRoute(route: string, targetPath: string, allowedQuery: string[] = []) {
    router.get(`/:id/${route}`, async (c) => {
        const authError = await requireAdmin(c);
        if (authError) return authError;

        const serverId = c.req.param("id");

        if (!isSafeParam(serverId)) {
            return c.json({ error: "Invalid server ID" }, 400);
        }

        const qs = new URLSearchParams();
        for (const k of allowedQuery) {
            const v = c.req.query(k);
            if (v != null && v !== "") qs.set(k, v);
        }
        const tail = qs.toString() ? `?${qs.toString()}` : "";

        try {
            const response = await fetch(`https://${serverId}.fastr-analytics.org/${targetPath}${tail}`);
            const data = await response.json();
            return c.json(data);
        } catch (error) {
            return c.json({ error: String(error) }, 500);
        }
    });
}

proxyRoute("pg_stat_statements", "pg_stat_statements", ["orderBy", "limit", "minMeanMs"]);
proxyRoute("ai_usage", "ai_usage");
proxyRoute("ai_weekly_usage", "ai_weekly_usage");
proxyRoute("ai_limit_hits", "ai_limit_hits", ["since"]);
proxyRoute("user_logs_all", "user_logs_all");
proxyRoute("user_logs_aggregate", "user_logs_aggregate");
proxyRoute("user_logs", "user_logs");
proxyRoute("user_activity", "user_activity", ["email"]);
proxyRoute("status", "health_check");

// Update server version
router.post("/:id/update", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");
    const { version } = await c.req.json();

    if (!isSafeParam(serverId) || !isSafeParam(version)) {
        return c.json({ error: "Invalid server ID or version format" }, 400);
    }

    const server = await getServerInfo(serverId);
    if (!server || !server.id) {
        return c.json({ error: "Server not found" }, 404);
    }

    const command = `wb c update ${serverId} --server ${version}`;
    console.log(command);

    if (!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Bulk update server versions
router.post("/bulk-update", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ ids: string[], version: string }>();
    const ids: string[] = body.ids;
    const version: string = body.version;

    if (!ids.every(id => isSafeParam(id)) || !isSafeParam(version)) {
        return c.json({ error: "Invalid server ID or version format" }, 400);
    }

    const command = "wb c update " + ids.join(" ") + " --server " + version;

    if (!isCommandAllowed(command)) {
        return c.json({ error: "command not allowed" }, 403);
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// update server language
router.post("/update/language", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string, french: boolean, portuguese?: boolean }>();
    const serverId: string = body.serverId;
    const french: boolean = body.french;
    const portuguese: boolean = body.portuguese ?? false;

    // Language is mutually exclusive (English / French / Portuguese), so always
    // set both flags to keep them coherent — at most one can be true.
    const commands = [
        `wb c update ${serverId} --french ${french}`,
        `wb c update ${serverId} --portuguese ${portuguese}`,
    ];

    if (commands.some((command) => !isCommandAllowed(command))) {
        return c.json({ error: "command not allowed" }, 403);
    }

    try {
        const ip = getDropletIp();
        const results = [];
        for (const command of commands) {
            const result = await executeCommand(ip, command);
            results.push(result);
            if (!result.success) {
                return c.json({
                    success: false,
                    message: result.stdout,
                    error: result.stderr,
                });
            }
        }
        return c.json({
            success: true,
            message: results.map((r) => r.stdout).join("\n"),
            error: results.map((r) => r.stderr).join("\n"),
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// update server calendar
router.post("/update/calendar", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string, ethiopian: boolean }>();
    const serverId: string = body.serverId;
    const ethiopian: boolean = body.ethiopian;

    const command = `wb c update ${serverId} --ethiopian ${ethiopian}`

    if (!isCommandAllowed(command)) {
        return c.json({ error: "command not allowed" }, 403);
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// update server open access status
router.post("/update/open-access", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string, openAccess: boolean }>();
    const serverId: string = body.serverId;
    const openAccess: boolean = body.openAccess;

    const command = `wb c update ${serverId} --open-access ${openAccess}`

    if (!isCommandAllowed(command)) {
        return c.json({ error: "command not allowed" }, 403);
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Get server docker logs
router.get("/:id/logs", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");

    if (!isSafeParam(serverId)) {
        return c.json({ success: false, logs: '', error: "Invalid server ID" });
    }

    const command = `docker logs ${serverId}`;
    const inspectCommand = `docker inspect -f '{{.Id}}' ${serverId}`;

    if (!isCommandAllowed(command) || !isCommandAllowed(inspectCommand)) {
        return c.json({ success: false, logs: '', containerId: null, error: "Command not allowed" });
    }

    try {
        // Container ID lets the frontend tell a freshly restarted container apart
        // from the old one (wb restart removes and recreates the container).
        const inspectResult = await executeCommand(getDropletIp(), inspectCommand);
        const containerId = inspectResult.success ? inspectResult.stdout.trim() : null;

        const result = await executeCommand(getDropletIp(), command);
        if (!result.success) {
            return c.json({ success: false, logs: '', containerId, error: result.stderr });
        }
        return c.json({ success: true, logs: result.stdout, containerId, error: '' });
    } catch (error) {
        return c.json({ success: false, logs: '', containerId: null, error: String(error) });
    }
});

// Proxy user activity from a platform instance
// Get all locked servers
router.get("/locks", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;
    return c.json(await readLocks());
});

// Lock a server
router.post("/:id/lock", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;
    const id = c.req.param("id");
    if (!isSafeParam(id)) return c.json({ error: "Invalid server id" }, 400);
    const locks = await readLocks();
    if (!locks.includes(id)) {
        locks.push(id);
        await writeLocks(locks);
    }
    return c.json({ locked: true });
});

// Unlock a server
router.delete("/:id/lock", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;
    const id = c.req.param("id");
    if (!isSafeParam(id)) return c.json({ error: "Invalid server id" }, 400);
    const locks = (await readLocks()).filter(l => l !== id);
    await writeLocks(locks);
    return c.json({ locked: false });
});

// Change label for server
router.post("/update/label", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string, newLabel: string }>();
    const serverId = body.serverId;
    const newLabel = body.newLabel;

    const command = `wb c update ${serverId} --label "${newLabel}"`;

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, error: "Invalid command" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Update server volume
router.post("/update/volume", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string, volume: string }>();
    const serverId = body.serverId;
    const volume = body.volume;

    const command = `wb c update ${serverId} --volume ${volume}`;

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, error: "Invalid command" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Run a server
router.post("/run", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    if (!isSafeParam(serverId)) {
        return c.json({ success: false, error: "Invalid server ID" });
    }

    const server = await getServerInfo(serverId);
    const command = server?.mode === "central" ? `wb run-central ${serverId}` : `wb run ${serverId}`;

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, error: "Invalid command" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Stop bulk servers
router.post("/bulk-stop", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ ids: string[] }>();
    const ids: string[] = body.ids;

    if (!ids.every(id => isSafeParam(id))) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    const command = "wb stop " + ids.join(" ");

    if (!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Stop a server
router.post("/stop", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb stop ${serverId}`;

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, error: "Invalid command" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

export default router;
