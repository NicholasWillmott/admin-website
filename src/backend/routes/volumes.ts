/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin, requireAdminOrInternal } from "../lib/auth.ts";
import { executeCommand, isCommandAllowed } from "../ssh.ts";

const router = new Hono();

interface DfStats {
  filesystem: string;
  totalGB: number;
  usedGB: number;
  availableGB: number;
  usePercent: number;
  mountedOn: string;
}

interface DirEntry {
  name: string;
  sizeGB: number;
}

function parseDfOutput(output: string, mountPath: string): DfStats | null {
  const lines = output.trim().split("\n").slice(1);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [filesystem, total, used, available, useRaw, mountedOn] = parts;
    if (mountedOn !== mountPath) continue;
    const parseGB = (val: string) => parseInt(val.replace("G", ""), 10) || 0;
    return {
      filesystem,
      totalGB: parseGB(total),
      usedGB: parseGB(used),
      availableGB: parseGB(available),
      usePercent: parseInt(useRaw.replace("%", ""), 10) || 0,
      mountedOn,
    };
  }
  return null;
}

function parseDuOutput(output: string, mountPath: string): DirEntry[] {
  const entries: DirEntry[] = [];
  const lines = output.trim().split("\n");
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const [sizeRaw, dirPath] = parts;
    // Skip the mount root itself (du includes a total for the directory itself)
    if (dirPath === mountPath) continue;
    const name = dirPath.split("/").at(-1) ?? dirPath;
    entries.push({
      name,
      sizeGB: parseInt(sizeRaw.replace("G", ""), 10) || 0,
    });
  }
  return entries;
}

// GET /api/volumes/list
router.get("/list", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const dropletIp = Deno.env.get("DROPLET_IP");
  if (!dropletIp) {
    return c.json({ success: false, error: "DROPLET_IP not configured" }, 500);
  }

  const command = "ls /mnt";
  if (!isCommandAllowed(command)) {
    return c.json({ success: false, error: "Command not allowed" }, 403);
  }

  const result = await executeCommand(dropletIp, command);
  if (!result.success) {
    return c.json({ success: false, error: result.stderr || "Failed to list /mnt" }, 500);
  }

  const volumes = result.stdout.trim().split("\n").map(s => s.trim()).filter(Boolean);
  return c.json({ success: true, volumes });
});

// GET /api/volumes/usage?volume=volume_nyc3_abc
router.get("/usage", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const volumeName = c.req.query("volume");
  if (!volumeName || !/^[\w_-]+$/.test(volumeName)) {
    return c.json({ success: false, error: "Missing or invalid volume name" }, 400);
  }

  const dropletIp = Deno.env.get("DROPLET_IP");
  if (!dropletIp) {
    return c.json({ success: false, error: "DROPLET_IP not configured" }, 500);
  }

  const mountPath = `/mnt/${volumeName}`;

  const dfCommand = `df -BG ${mountPath}`;
  const duCommand = `du -BG --max-depth=1 ${mountPath}`;

  if (!isCommandAllowed(dfCommand) || !isCommandAllowed(duCommand)) {
    return c.json({ success: false, error: "Command not allowed" }, 403);
  }

  const [dfResult, duResult] = await Promise.all([
    executeCommand(dropletIp, dfCommand),
    executeCommand(dropletIp, duCommand),
  ]);

  const dfStats = dfResult.success ? parseDfOutput(dfResult.stdout, mountPath) : null;
  const directories = duResult.success ? parseDuOutput(duResult.stdout, mountPath) : [];

  if (!dfStats) {
    return c.json({
      success: false,
      error: dfResult.stderr || `Could not get stats for ${mountPath}`,
    }, 500);
  }

  return c.json({
    success: true,
    volumeName,
    mountPath,
    df: dfStats,
    directories,
  });
});

// Grow the ext4 filesystem to fill the (just-resized) block device, using the
// DO by-id device path (confirmed working for these volumes). Logs the result so
// a failure here is visible instead of silently swallowed.
async function expandFilesystem(dropletIp: string, volumeName: string): Promise<void> {
  const fsCmd = `resize2fs /dev/disk/by-id/scsi-0DO_Volume_${volumeName}`;
  if (!isCommandAllowed(fsCmd)) {
    console.error(`[volumes/resize] resize2fs command not allowed: ${fsCmd}`);
    return;
  }
  const fsRes = await executeCommand(dropletIp, fsCmd);
  if (fsRes.success) {
    console.log(`[volumes/resize] resize2fs ok for "${volumeName}": ${fsRes.stdout.trim()}`);
  } else {
    console.error(`[volumes/resize] resize2fs failed for "${volumeName}": code=${fsRes.code} stdout="${fsRes.stdout.trim()}" stderr="${fsRes.stderr.trim()}"`);
  }
}

// POST /api/volumes/resize
// Called internally by platform server containers via X-Internal-Key header,
// or by Clerk-authenticated admins. Triggers a DigitalOcean volume resize,
// then expands the filesystem once the action completes.
router.post("/resize", async (c) => {
  const authError = await requireAdminOrInternal(c);
  if (authError) return authError;

  let volumeName: string | undefined;
  let targetSizeGB: number | undefined;
  try {
    const body = await c.req.json();
    volumeName = typeof body?.volume === "string" ? body.volume.trim() : undefined;
    targetSizeGB = typeof body?.targetSizeGB === "number" ? body.targetSizeGB : undefined;
  } catch {
    // no body
  }

  if (!volumeName || !/^[\w_-]+$/.test(volumeName)) {
    return c.json({ success: false, error: "Missing or invalid volume name" }, 400);
  }
  if (!targetSizeGB || targetSizeGB <= 0) {
    return c.json({ success: false, error: "Missing or invalid targetSizeGB" }, 400);
  }

  // Clamp the requested size to a configurable ceiling so a mis-measurement or
  // runaway trigger loop can't grow the volume (and the bill) without bound.
  const maxSizeRaw = Number(Deno.env.get("MAX_VOLUME_SIZE_GB"));
  const maxSizeGB = Number.isFinite(maxSizeRaw) && maxSizeRaw > 0 ? Math.floor(maxSizeRaw) : 2000;
  if (targetSizeGB > maxSizeGB) {
    console.warn(`[volumes/resize] target ${targetSizeGB}GB exceeds cap ${maxSizeGB}GB for "${volumeName}"; clamping to cap`);
    targetSizeGB = maxSizeGB;
  }

  const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
  if (!doToken) {
    return c.json({ success: false, error: "DigitalOcean API token not configured" }, 503);
  }

  const dropletIp = Deno.env.get("DROPLET_IP");
  if (!dropletIp) {
    return c.json({ success: false, error: "DROPLET_IP not configured" }, 503);
  }

  // Look up volume by name to get its ID and current size
  const lookup = await fetch(
    `https://api.digitalocean.com/v2/volumes?name=${encodeURIComponent(volumeName)}`,
    { headers: { "Authorization": `Bearer ${doToken}` } },
  ).catch(() => null);
  if (!lookup?.ok) {
    return c.json({ success: false, error: `Failed to look up volume "${volumeName}"` }, 500);
  }
  const lookupData = await lookup.json();
  const volume = lookupData.volumes?.[0];
  const volumeId = volume?.id as string | undefined;
  if (!volumeId) {
    return c.json({ success: false, error: `Volume "${volumeName}" not found` }, 404);
  }
  const currentSizeGB = (volume?.size_gigabytes as number | undefined) ?? 0;
  if (currentSizeGB >= targetSizeGB) {
    return c.json({ success: true, message: "Volume already at target size, no resize needed" });
  }

  // Don't stack resizes: if one is already in progress, report that and stop so
  // repeated triggers (e.g. every module run while the disk is full) don't create
  // duplicate DO actions and duplicate notifications.
  const actionsRes = await fetch(
    `https://api.digitalocean.com/v2/volumes/${volumeId}/actions`,
    { headers: { "Authorization": `Bearer ${doToken}` } },
  ).catch(() => null);
  if (actionsRes?.ok) {
    const actionsData = await actionsRes.json();
    const inProgress = (actionsData.actions ?? []).some(
      (a: { type?: string; status?: string }) => a.type === "resize" && a.status === "in-progress",
    );
    if (inProgress) {
      console.log(`[volumes/resize] resize already in progress for "${volumeName}", skipping`);
      return c.json({ success: true, message: "Volume resize already in progress" });
    }
  }

  // Trigger the block-device resize via DO API
  const resizeRes = await fetch(`https://api.digitalocean.com/v2/volumes/${volumeId}/actions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${doToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "resize", size_gigabytes: targetSizeGB }),
  }).catch(() => null);
  if (!resizeRes?.ok) {
    const err = await resizeRes?.json().catch(() => ({})) ?? {};
    const msg = (err as { message?: string }).message || "Failed to trigger resize";
    const tokenFp = doToken ? `len=${doToken.length} …${doToken.slice(-4)}` : "MISSING";
    console.error(`[volumes/resize] DO resize request failed for "${volumeName}": HTTP ${resizeRes?.status} ${JSON.stringify(err)} (DO token ${tokenFp})`);
    // Echo the DO status, error body and token fingerprint in the response so the
    // detail also surfaces in the calling platform server's logs, not only here.
    return c.json({
      success: false,
      error: `${msg} (DO HTTP ${resizeRes?.status}, token ${tokenFp})`,
      doStatus: resizeRes?.status,
      doError: err,
    }, 500);
  }
  const resizeData = await resizeRes.json();
  const actionId = resizeData.action?.id as number | undefined;
  if (!actionId) {
    console.error(`[volumes/resize] no action id returned for "${volumeName}": ${JSON.stringify(resizeData)}`);
    return c.json({ success: false, error: "No action ID returned from resize request" }, 500);
  }
  console.log(`[volumes/resize] DO resize action ${actionId} created for "${volumeName}" (${currentSizeGB}GB -> ${targetSizeGB}GB)`);

  // Poll for completion in background, then expand the filesystem
  (async () => {
    try {
      for (let i = 0; i < 60; i++) { // max ~30 minutes
        await new Promise((r) => setTimeout(r, 30_000));
        const poll = await fetch(
          `https://api.digitalocean.com/v2/volumes/${volumeId}/actions/${actionId}`,
          { headers: { "Authorization": `Bearer ${doToken}` } },
        ).catch(() => null);
        if (!poll?.ok) {
          console.error(`[volumes/resize] action ${actionId} poll failed: HTTP ${poll?.status}`);
          break;
        }
        const pollData = await poll.json();
        const status = pollData.action?.status;
        if (status === "completed") {
          console.log(`[volumes/resize] DO action ${actionId} completed for "${volumeName}"; expanding filesystem`);
          await expandFilesystem(dropletIp, volumeName);
          break;
        }
        if (status === "errored") {
          console.error(`[volumes/resize] DO action ${actionId} errored for "${volumeName}": ${JSON.stringify(pollData.action)}`);
          break;
        }
      }
    } catch (e) {
      console.error(`[volumes/resize] background poll error for "${volumeName}": ${e}`);
    }
  })();

  return c.json({
    success: true,
    message: `Volume resize from ${currentSizeGB} GB to ${targetSizeGB} GB triggered. Filesystem will be expanded automatically.`,
  });
});

export default router;
