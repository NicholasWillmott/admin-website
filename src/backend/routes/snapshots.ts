/// <reference lib="deno.ns" />
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requireAdmin } from "../lib/auth.ts";

const router = new Hono();

// Delete a volume snapshot by ID
router.delete("/server/snapshot/:id", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const volumeId = Deno.env.get("VOLUME_ID");
    const snapshotId = c.req.param("id");

    if (!doToken || !volumeId) {
        return c.json({ success: false, error: "Digital Ocean API token or Volume ID not found" });
    }

    try {
        const response = await fetch(`https://api.digitalocean.com/v2/snapshots/${snapshotId}`, {
            method: "DELETE",
            headers: {
                "Authorization": `Bearer ${doToken}`,
                "Content-Type": "application/json",
            },
        });

        if (response.status === 204) {
            return c.json({ success: true, message: `Snapshot deleted successfully` });
        } else if (!response.ok) {
            const result = await response.json();
            return c.json({ success: false, error: result.message || "Failed to delete snapshot" });
        }
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// Take a snapshot of the main droplet volume
router.post("/server/snapshot", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const volumeId = Deno.env.get("VOLUME_ID");

    if (!doToken || !volumeId) {
        return c.json({ success: false, error: "Digital Ocean API token or Volume ID not found" });
    }

    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const snapshotName = `${volumeId}-snapshot-${timestamp}`;

        const response = await fetch(`https://api.digitalocean.com/v2/volumes/${volumeId}/snapshots`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${doToken}`,
            },
            body: JSON.stringify({
                name: snapshotName,
                description: `Snapshot for ${volumeId} created via admin dashboard`,
            }),
        });

        const result = await response.json();

        if (response.ok) {
            return c.json({
                success: true,
                snapshot: result.snapshot,
                message: `Snapshot ${snapshotName} created successfully`,
            });
        } else {
            return c.json({ success: false, error: result.message || "Failed to create snapshot" });
        }
    } catch (error) {
        return c.json({ success: false, error: String(error) });
    }
});

// List all snapshots for the volume
router.get("/servers/snapshots", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const volumeId = Deno.env.get("VOLUME_ID");

    if (!doToken || !volumeId) {
        return c.json({ success: false, error: 'Missing DigitalOcean credentials' }, 500);
    }

    try {
        const response = await fetch(
            `https://api.digitalocean.com/v2/volumes/${volumeId}/snapshots`,
            {
                headers: {
                    'Authorization': `Bearer ${doToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            return c.json(
                { success: false, error: `DigitalOcean API error: ${errorText}` },
                response.status as ContentfulStatusCode
            );
        }

        const data = await response.json();
        return c.json({ success: true, snapshots: data.snapshots || [] });
    } catch (error) {
        console.error('Error fetching volume snapshots:', error);
        return c.json({ success: false, error: 'Failed to fetch snapshots' }, 500);
    }
});

export default router;
