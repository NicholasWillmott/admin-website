/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
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

const VOLUMES_FILE = new URL('../data/volumes.json', import.meta.url).pathname;

// GET /api/volumes/list
router.get("/list", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  try {
    const text = await Deno.readTextFile(VOLUMES_FILE);
    const data = JSON.parse(text);
    return c.json({ success: true, volumes: data.volumes ?? [] });
  } catch {
    return c.json({ success: true, volumes: [] });
  }
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

export default router;
