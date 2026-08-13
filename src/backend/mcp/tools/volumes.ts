/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { getDropletIp } from "../../lib/utils.ts";
import { executeCommand, READ_TIMEOUT_MS } from "../../ssh.ts";
import { parseDfOutput } from "../../routes/volumes.ts";
import {
  fetchServersJson,
  mapConcurrent,
  okJson,
  runTool,
  ToolFailure,
} from "./helpers.ts";

// get_volume_usage — capacity and risk per DigitalOcean block-storage volume.
//
// DELIBERATELY NOT a duplicate of get_disk_breakdown (fleet.ts), which answers
// "which directory is eating the space?" by running du across every volume.
// This one answers "which volumes are about to cause an outage, and who goes
// down when they do?" and adds the three things df alone cannot tell you:
//
//   1. Which instances live on each volume (servers.json `volume` field), so a
//      full volume maps to named countries rather than a device name.
//   2. The DigitalOcean provisioned size alongside the filesystem size. These
//      diverge when a DO resize succeeded but resize2fs did not — precisely the
//      half-finished state routes/volumes.ts expandFilesystem() guards against,
//      and invisible to df on its own.
//   3. Headroom against MAX_VOLUME_SIZE_GB, the ceiling the resize route clamps
//      to, so "just resize it" can be judged before it is suggested.
//
// No du here: it is the slow part, and get_disk_breakdown already owns it.

const DEFAULT_MAX_VOLUME_SIZE_GB = 2000;
const WARN_USE_PERCENT = 75;
const CRITICAL_USE_PERCENT = 90;
const DO_TIMEOUT_MS = 15_000;

interface DoVolume {
  id: string;
  size_gigabytes: number;
  region?: { slug?: string };
}

// null = could not be determined (no token, API error, unknown name). The tool
// still returns df data in that case — degrading is better than failing the
// whole call, since capacity is useful without the DO view.
async function fetchDoVolume(name: string): Promise<DoVolume | null> {
  const token = Deno.env.get("DIGITALOCEAN_API_TOKEN");
  if (!token) return null;
  try {
    const response = await fetch(
      `https://api.digitalocean.com/v2/volumes?name=${encodeURIComponent(name)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(DO_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const body = await response.json() as { volumes?: DoVolume[] };
    return body.volumes?.[0] ?? null;
  } catch {
    return null;
  }
}

function riskOf(usePercent: number): "critical" | "warning" | "ok" {
  if (usePercent >= CRITICAL_USE_PERCENT) return "critical";
  if (usePercent >= WARN_USE_PERCENT) return "warning";
  return "ok";
}

export function registerVolumeTools(server: McpServer): void {
  server.registerTool("get_volume_usage", {
    title: "Volume capacity and risk",
    description:
      "Capacity of every DigitalOcean block-storage volume on the droplet: filesystem totals (df), the DO provisioned size, " +
      "which instances live on each volume, and remaining headroom before the resize ceiling. Flags volumes at risk of filling. " +
      "For per-directory sizes (which folder is eating the space) use get_disk_breakdown instead.",
    inputSchema: z.object({
      volume: z.string().optional().describe(
        "Volume name (e.g. \"volume03\"). Omit for every volume on the droplet.",
      ),
    }),
    annotations: { readOnlyHint: true },
  }, ({ volume }) =>
    runTool(async () => {
      if (volume !== undefined && !/^[\w_-]+$/.test(volume)) {
        throw new ToolFailure(
          `Invalid volume name "${volume}" — names are letters, digits, underscores and hyphens.`,
        );
      }

      const lsCommand = "ls /mnt";
      const lsResult = await executeCommand(getDropletIp(), lsCommand, { timeoutMs: READ_TIMEOUT_MS });
      if (!lsResult.success) {
        throw new ToolFailure(
          `Could not list volumes: ${lsResult.stderr.slice(0, 300)}`,
        );
      }
      const allVolumes = lsResult.stdout.trim().split("\n")
        .map((s) => s.trim()).filter(Boolean);

      const names = volume ? allVolumes.filter((v) => v === volume) : allVolumes;
      if (volume && names.length === 0) {
        throw new ToolFailure(
          `No volume "${volume}" mounted on the droplet. Mounted: ${allVolumes.join(", ") || "none"}.`,
        );
      }

      const maxRaw = Number(Deno.env.get("MAX_VOLUME_SIZE_GB"));
      const maxSizeGB = Number.isFinite(maxRaw) && maxRaw > 0
        ? Math.floor(maxRaw)
        : DEFAULT_MAX_VOLUME_SIZE_GB;

      // Registry lookup is one fetch, reused for every volume
      const servers = await fetchServersJson();

      const volumes = await mapConcurrent(names, 4, async (name) => {
        const mountPath = `/mnt/${name}`;
        const dfCommand = `df -BG ${mountPath}`;
        const [dfResult, doVolume] = await Promise.all([
          executeCommand(getDropletIp(), dfCommand, { timeoutMs: READ_TIMEOUT_MS }),
          fetchDoVolume(name),
        ]);
        const df = dfResult.success ? parseDfOutput(dfResult.stdout, mountPath) : null;

        const serversOnVolume = servers
          .filter((s) => s.volume === name)
          .map((s) => ({ id: s.id, label: s.label }));

        // df reports the ext4 filesystem; DO reports the block device. A
        // mismatch means a resize only half-completed.
        const filesystemGB = df?.totalGB ?? null;
        const provisionedGB = doVolume?.size_gigabytes ?? null;
        const resizeIncomplete = filesystemGB !== null && provisionedGB !== null &&
          provisionedGB - filesystemGB >= 1;

        return {
          name,
          mountPath,
          df,
          dfNote: df === null
            ? "not a dedicated mount — no volume-level totals (see get_disk_breakdown)"
            : undefined,
          risk: df ? riskOf(df.usePercent) : "unknown",
          provisionedGB,
          provisionedNote: provisionedGB === null
            ? "DigitalOcean size unavailable (no API token, or no DO volume by this name)"
            : undefined,
          resizeIncomplete: resizeIncomplete || undefined,
          resizeIncompleteNote: resizeIncomplete
            ? `DigitalOcean reports ${provisionedGB}GB but the filesystem is only ${filesystemGB}GB — ` +
              `a resize did not finish expanding the filesystem. The extra space is paid for and unusable.`
            : undefined,
          headroomToCapGB: provisionedGB === null ? null : Math.max(0, maxSizeGB - provisionedGB),
          serversOnVolume,
          region: doVolume?.region?.slug,
        };
      });

      const atRisk = volumes
        .filter((v) => v.risk === "critical" || v.risk === "warning")
        .map((v) => ({
          name: v.name,
          usePercent: v.df?.usePercent,
          risk: v.risk,
          affects: v.serversOnVolume?.map((s) => s.id) ?? [],
        }));

      return okJson({
        volumes,
        atRisk,
        maxVolumeSizeGB: maxSizeGB,
        thresholds: { warning: WARN_USE_PERCENT, critical: CRITICAL_USE_PERCENT },
        note: atRisk.length === 0
          ? "No volume is above the warning threshold."
          : `${atRisk.length} volume(s) at or above ${WARN_USE_PERCENT}% — the instances listed in "affects" go down if one fills.`,
      });
    }));
}
