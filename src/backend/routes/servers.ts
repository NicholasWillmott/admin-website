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

    const command = `wb restart ${serverId}`;
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

    const command = "wb restart " + ids.join(" ");

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

// Get server status
router.get("/:id/status", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");

    if (!isSafeParam(serverId)) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/health_check`);
        const data = await response.json();
        return c.json(data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

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

    const body = await c.req.json<{ serverId: string, french: boolean }>();
    const serverId: string = body.serverId;
    const french: boolean = body.french;

    const command = `wb c update ${serverId} --french ${french}`

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

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, logs: '', error: "Command not allowed" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        if (!result.success) {
            return c.json({ success: false, logs: '', error: result.stderr });
        }
        return c.json({ success: true, logs: result.stdout, error: '' });
    } catch (error) {
        return c.json({ success: false, logs: '', error: String(error) });
    }
});

// Proxy user activity from a platform instance
router.get("/:id/user_activity", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");
    const email = c.req.query("email") ?? "";

    if (!isSafeParam(serverId)) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/user_activity?email=${encodeURIComponent(email)}`);
        const data = await response.json();
        return c.json(data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

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

// Run a server
router.post("/run", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb run ${serverId}`;

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
