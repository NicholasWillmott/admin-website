/// <reference lib="deno.ns" />
import { Hono } from "hono";

import { requireAdmin } from "../lib/auth.ts";
import { listMountedVolumes } from "./volumes.ts";

const router = new Hono();

// Delete a volume snapshot by ID
router.delete("/server/snapshot/:id", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const snapshotId = c.req.param("id");

    // Must not contain "." or "/": an encoded traversal like "..%2Fdroplets%2F<id>" is
    // normalised by the URL parser and would turn this into a DELETE against a different
    // DigitalOcean resource entirely, using the account token.
    if (!/^[a-fA-F0-9-]{8,64}$/.test(snapshotId)) {
        return c.json({ success: false, error: "Invalid snapshot id" }, 400);
    }

    if (!doToken) {
        return c.json({ success: false, error: "DigitalOcean API token not found" });
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
        // DO documents 204, but any other 2xx is still a success — without this the handler
        // falls off the end and Hono returns an empty 500.
        return c.json({ success: true, message: `Snapshot deleted successfully` });
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

// List snapshots for every volume mounted on the droplet, plus any extra names in
// VOLUME_NAMES (e.g. a volume that has been unmounted but still has snapshots worth seeing).
// A volume that no longer exists on DigitalOcean is skipped rather than failing the list.
router.get("/servers/snapshots", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    if (!doToken) {
        return c.json({ success: false, error: 'Missing DigitalOcean credentials' }, 500);
    }

    const extraNames = (Deno.env.get("VOLUME_NAMES") ?? "")
        .split(",").map((n: string) => n.trim()).filter(Boolean);

    const warnings: string[] = [];
    const dropletIp = Deno.env.get("DROPLET_IP");
    let mounted: string[] = [];
    if (dropletIp) {
        const result = await listMountedVolumes(dropletIp);
        if (result.success) mounted = result.volumes;
        else warnings.push(`Could not list mounted volumes: ${result.error}`);
    }

    const volumeNames = [...new Set([...mounted, ...extraNames])];
    if (volumeNames.length === 0) {
        return c.json({ success: false, error: 'No volumes found (droplet /mnt is empty and VOLUME_NAMES is unset)' }, 500);
    }

    try {
        const perVolume = await Promise.all(
            volumeNames.map(async (name) => {
                const lookup = await fetch(
                    `https://api.digitalocean.com/v2/volumes?name=${encodeURIComponent(name)}`,
                    { headers: { 'Authorization': `Bearer ${doToken}` } }
                );
                if (!lookup.ok) {
                    warnings.push(`Failed to look up volume "${name}"`);
                    return [];
                }
                const volumeId = (await lookup.json()).volumes?.[0]?.id as string | undefined;
                if (!volumeId) {
                    warnings.push(`Volume "${name}" not found on DigitalOcean`);
                    return [];
                }

                const response = await fetch(
                    `https://api.digitalocean.com/v2/volumes/${volumeId}/snapshots?per_page=200`,
                    { headers: { 'Authorization': `Bearer ${doToken}` } }
                );
                if (!response.ok) {
                    warnings.push(`Failed to fetch snapshots for volume "${name}"`);
                    return [];
                }
                return (await response.json()).snapshots || [];
            })
        );

        if (warnings.length > 0) console.warn('Volume snapshot listing:', warnings.join('; '));
        return c.json({ success: true, snapshots: perVolume.flat(), volumes: volumeNames, warnings });
    } catch (error) {
        console.error('Error fetching volume snapshots:', error);
        return c.json({ success: false, error: String(error) }, 500);
    }
});

export default router;
