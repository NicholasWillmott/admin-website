/// <reference lib="deno.ns" />
import { Hono } from "hono";

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

// Take a snapshot of a named droplet volume
router.post("/server/snapshot", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    if (!doToken) {
        return c.json({ success: false, error: "Digital Ocean API token not found" });
    }

    let volumeName: string | undefined;
    let customName: string | undefined;
    try {
        const body = await c.req.json();
        volumeName = typeof body?.volume === "string" ? body.volume.trim() : undefined;
        customName = typeof body?.name === "string" ? body.name.trim() : undefined;
    } catch {
        // no body
    }

    if (!volumeName) {
        return c.json({ success: false, error: "Volume name is required" }, 400);
    }

    // Names containing these substrings are matched by the cleanup-snapshots.sh
    // rotation job's retention filter and would be auto-deleted within days.
    if (customName) {
        const reserved = ["-daily-", "-weekly-", "-monthly-"].find(t => customName!.includes(t));
        if (reserved) {
            return c.json({
                success: false,
                error: `Snapshot name cannot contain "${reserved}" — that pattern is reserved for the automated rotation job.`,
            }, 400);
        }
    }

    try {
        const lookup = await fetch(
            `https://api.digitalocean.com/v2/volumes?name=${encodeURIComponent(volumeName)}`,
            { headers: { "Authorization": `Bearer ${doToken}` } },
        );
        if (!lookup.ok) {
            return c.json({ success: false, error: `Failed to look up volume "${volumeName}"` });
        }
        const lookupData = await lookup.json();
        const volumeId = lookupData.volumes?.[0]?.id as string | undefined;
        if (!volumeId) {
            return c.json({ success: false, error: `Volume "${volumeName}" not found` }, 404);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const snapshotName = customName || `${volumeName}-snapshot-${timestamp}`;

        const response = await fetch(`https://api.digitalocean.com/v2/volumes/${volumeId}/snapshots`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${doToken}`,
            },
            body: JSON.stringify({
                name: snapshotName,
                description: `Snapshot for ${volumeName} created via admin dashboard`,
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

// List all snapshots for one or more named volumes
router.get("/servers/snapshots", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const volumeNamesRaw: string = Deno.env.get("VOLUME_NAMES") ?? "";
    const volumeNames: string[] = volumeNamesRaw.split(",").map((n: string) => n.trim()).filter(Boolean);

    if (!doToken || volumeNames.length === 0) {
        return c.json({ success: false, error: 'Missing DigitalOcean credentials or VOLUME_NAMES' }, 500);
    }

    try {
        // Resolve each volume name to its ID
        const volumeIds = await Promise.all(
            volumeNames.map(async (name) => {
                const response = await fetch(
                    `https://api.digitalocean.com/v2/volumes?name=${encodeURIComponent(name)}`,
                    { headers: { 'Authorization': `Bearer ${doToken}` } }
                );
                if (!response.ok) throw new Error(`Failed to look up volume "${name}"`);
                const data = await response.json();
                const volume = data.volumes?.[0];
                if (!volume) throw new Error(`Volume "${name}" not found`);
                return volume.id as string;
            })
        );

        // Fetch snapshots for each resolved volume ID
        const results = await Promise.all(
            volumeIds.map(async (volumeId) => {
                const response = await fetch(
                    `https://api.digitalocean.com/v2/volumes/${volumeId}/snapshots?per_page=200`,
                    { headers: { 'Authorization': `Bearer ${doToken}` } }
                );
                if (!response.ok) throw new Error(`Failed to fetch snapshots for volume ID ${volumeId}`);
                const data = await response.json();
                return data.snapshots || [];
            })
        );

        return c.json({ success: true, snapshots: results.flat() });
    } catch (error) {
        console.error('Error fetching volume snapshots:', error);
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export default router;
