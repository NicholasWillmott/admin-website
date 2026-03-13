/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import { isSafeParam, getDropletIp } from "../lib/utils.ts";
import { executeCommand, isCommandAllowed } from "../ssh.ts";

const router = new Hono();

// Create DNS A record for new server
router.post("/create/record", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ subdomain: string }>();
    const subdomain = body.subdomain;

    if (!isSafeParam(subdomain)) {
        return c.json({ success: false, error: "Invalid subdomain" });
    }

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const dropletIp = Deno.env.get("DROPLET_IP");

    try {
        const response = await fetch("https://api.digitalocean.com/v2/domains/fastr-analytics.org/records", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${doToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "A",
                name: subdomain,
                data: dropletIp,
                ttl: 3600,
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            return c.json({ success: false, error: result.message || "Failed to create DNS record" }, response.status as any);
        }

        return c.json({ success: true, record: result.domain_record });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// Add server to config
router.post("/create/server", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb c add ${serverId}`;

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

// Init nginx for server
router.post("/create/nginx", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-nginx ${serverId}`;

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

// Init SSL for server
router.post("/create/ssl", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-ssl ${serverId}`;

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

// Init directories for server
router.post("/create/dirs", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-dirs ${serverId}`;

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
