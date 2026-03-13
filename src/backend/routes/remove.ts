/// <reference lib="deno.ns" />
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requireAdmin } from "../lib/auth.ts";
import { isSafeParam, getDropletIp } from "../lib/utils.ts";
import { executeCommand, isCommandAllowed } from "../ssh.ts";

const router = new Hono();

// Delete DNS record by subdomain name
router.delete("/remove/record", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ subdomain: string }>();
    const subdomain = body.subdomain;

    if (!isSafeParam(subdomain)) {
        return c.json({ success: false, error: "Invalid subdomain" });
    }

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");

    try {
        const listResponse = await fetch(
            `https://api.digitalocean.com/v2/domains/fastr-analytics.org/records?type=A&per_page=200`,
            { headers: { "Authorization": `Bearer ${doToken}` } }
        );

        if (!listResponse.ok) {
            const err = await listResponse.json();
            return c.json(
                { success: false, error: err.message || "Failed to list DNS records" },
                listResponse.status as ContentfulStatusCode
            );
        }

        const { domain_records } = await listResponse.json();
        const record = domain_records.find((r: { name: string }) => r.name === subdomain);

        if (!record) {
            return c.json({ success: false, error: "DNS record not found" }, 404);
        }

        const deleteResponse = await fetch(
            `https://api.digitalocean.com/v2/domains/fastr-analytics.org/records/${record.id}`,
            { method: "DELETE", headers: { "Authorization": `Bearer ${doToken}` } }
        );

        if (!deleteResponse.ok) {
            const err = await deleteResponse.json();
            return c.json(
                { success: false, error: err.message || "Failed to delete DNS record" },
                deleteResponse.status as ContentfulStatusCode
            );
        }

        return c.json({ success: true });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// Remove server from config
router.delete("/remove/server", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb c remove ${serverId} --force`;

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

// Remove nginx config for server
router.delete("/remove/nginx", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb remove-nginx ${serverId}`;

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

// Remove SSL for server
router.delete("/remove/ssl", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `printf "revoke ${serverId}\\n" | wb remove-ssl ${serverId}`;

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

// Remove directories for server
router.delete("/remove/dirs", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb remove-dirs ${serverId} --force`;

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
