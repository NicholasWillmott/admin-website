/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { getDropletIp } from "../../lib/utils.ts";
import { executeCommand } from "../../ssh.ts";
import {
  assignServerToCategory,
  checkServerConflicts,
  readCategoriesData,
} from "../../routes/create.ts";
import { errText, okText, runTool, ToolFailure } from "./helpers.ts";

// create_server — the connector's ONLY write tool. It mirrors the admin UI's
// Create Server modal exactly: the same six pre-flight conflict checks
// (routes/create.ts check route) and the same eight creation steps in the
// same order (CreateServerModal.tsx handleCreate).
//
// Safety model (two layers):
//   1. confirm:false (the default) NEVER mutates — it validates the config,
//      runs every conflict check, and returns a preview. confirm:true re-runs
//      the checks (state can change between calls) and aborts on any conflict
//      before the first mutating step.
//   2. The MCP client's own tool-permission prompt (this tool carries no
//      readOnlyHint, so clients treat it as a write and ask).
// There is no elicitation round trip — the platform found in-protocol
// confirms fail closed on claude.ai/Desktop; the confirm flag plus the
// client prompt is the reliable equivalent.

// Same subdomain rule as the modal (must also be shell-safe for the wb
// command whitelist, which lowercase letters/digits/hyphens are)
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// The wb label command is quoted in the whitelist as "[^"$`\\]+" — reject
// labels the whitelist would refuse so the failure is a clear message here,
// not a generic "Command not allowed" at step 6
const LABEL_SAFE_RE = /^[^"$`\\]+$/;

type WbResult = { success: boolean; detail: string };

async function runWb(command: string): Promise<WbResult> {
  const result = await executeCommand(getDropletIp(), command);
  return {
    success: result.success,
    detail: (result.success ? result.stdout : result.stderr).trim().slice(0, 400),
  };
}

async function listVolumes(): Promise<string[]> {
  const result = await executeCommand(getDropletIp(), "ls /mnt");
  if (!result.success) {
    throw new ToolFailure(`Could not list volumes: ${result.stderr.slice(0, 300)}`);
  }
  return result.stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
}

// The exact checks the admin UI's check route runs (routes/create.ts
// checkServerConflicts — one shared implementation), with keys renamed to
// read clearly in a model-facing report. true = conflict.
async function runConflictChecks(
  serverId: string,
  volume: string,
): Promise<Record<string, boolean>> {
  const c = await checkServerConflicts(serverId, volume);
  return {
    dnsRecordExists: c.dns,
    wbConfigExists: c.config,
    nginxConfigExists: c.nginx,
    sslCertExists: c.ssl,
    inServersJson: c.serversJson,
    directoryExistsOnVolume: c.directory ?? false,
  };
}

// One creation at a time. The admin UI serializes SSH operations client-side;
// the MCP surface enforces the same rule server-side so a retrying model (or
// two admins) can't interleave two creations.
let createInProgress = false;

const INPUT_SCHEMA = z.object({
  label: z.string().min(1).describe(
    'Display name shown in the fleet list, e.g. "Sierra Leone"',
  ),
  server_id: z.string().describe(
    'Subdomain / instance id, e.g. "sierraleone" becomes sierraleone.fastr-analytics.org. Lowercase letters, digits and hyphens only; max 63 chars.',
  ),
  volume: z.string().optional().describe(
    "Data volume to place the instance on (names from get_disk_breakdown — prefer the one with the most free space). Defaults to the first volume on the droplet, matching the admin UI.",
  ),
  category: z.string().optional().describe(
    "Existing category name from get_fleet_overview. Omit for uncategorized.",
  ),
  country_iso3: z.string().describe(
    'REQUIRED — the instance BOOT FAIL-STOPS without it. Three uppercase letters (e.g. "NGA") or "SOMALILAND". Testing instances conventionally use "SOM".',
  ),
  language: z.enum(["english", "french", "portuguese"]).default("english"),
  calendar: z.enum(["gregorian", "ethiopian"]).default("gregorian"),
  open_access: z.boolean().default(false),
  confirm: z.boolean().default(false).describe(
    "false (default) = preview only: validate, run all conflict checks, and report what WOULD happen — nothing is created. true = actually create. NEVER pass true until the user has seen the preview and explicitly approved it.",
  ),
});

export function registerCreateServerTool(server: McpServer): void {
  server.registerTool("create_server", {
    title: "Create a new FASTR instance",
    description:
      "Provision a new FASTR instance: DNS record, wb config, directories, nginx, SSL certificate, label/country/language/calendar/open-access config, category, then start the container — the same checks and steps as the admin UI's Create Server modal. Ask the user for every option rather than guessing (label, server_id, volume, category, country_iso3, language, calendar, open_access). ALWAYS call with confirm:false first and show the user the preview; only re-call with confirm:true after they explicitly approve. This creates real infrastructure and issues a real SSL certificate.",
    inputSchema: INPUT_SCHEMA,
  }, (input) =>
    runTool(async () => {
      const serverId = input.server_id.trim();
      const label = input.label.trim();

      // ---- validation (both phases) ----
      if (serverId.length > 63 || !SUBDOMAIN_RE.test(serverId)) {
        return errText(
          `Invalid server_id "${serverId}" — lowercase letters, digits and hyphens only (no leading/trailing hyphen), max 63 chars.`,
        );
      }
      if (!LABEL_SAFE_RE.test(label)) {
        return errText(
          'Invalid label — it may not contain double quotes, backslashes, $ or backticks.',
        );
      }
      // The platform refuses to boot without a valid country code (its
      // exposed_env_vars.ts fail-stop) — creating without one yields a
      // crash-looping container, which is how this parameter got added
      if (!/^[A-Z]{3}$|^SOMALILAND$/.test(input.country_iso3)) {
        return errText(
          `Invalid country_iso3 "${input.country_iso3}" — three uppercase letters (e.g. NGA) or SOMALILAND.`,
        );
      }
      const volumes = await listVolumes();
      const volume = input.volume ?? volumes[0];
      if (!volume || !volumes.includes(volume)) {
        return errText(
          `Volume "${input.volume}" not found on the droplet. Available: ${volumes.join(", ")}.`,
        );
      }
      if (input.category !== undefined) {
        const categories = (await readCategoriesData()).categories.map((c) => c.name);
        if (!categories.includes(input.category)) {
          return errText(
            `Category "${input.category}" does not exist. Available: ${categories.join(", ") || "(none)"}.`,
          );
        }
      }

      // ---- conflict checks (both phases; confirm re-runs them because state
      // can change between the preview and the user's approval) ----
      const conflicts = await runConflictChecks(serverId, volume);
      const found = Object.entries(conflicts).filter(([, v]) => v).map(([k]) => k);
      if (found.length > 0) {
        return errText(
          [
            `Cannot create "${serverId}" — conflicts found:`,
            ...found.map((k) => `- ${k}`),
            "Nothing was created. Pick a different server_id (or volume) and preview again.",
          ].join("\n"),
        );
      }

      const configSummary = [
        `label: "${label}"`,
        `server_id: ${serverId} (https://${serverId}.fastr-analytics.org)`,
        `volume: ${volume}${input.volume === undefined ? " (default — first on droplet)" : ""}`,
        `category: ${input.category ?? "(none)"}`,
        `country_iso3: ${input.country_iso3}`,
        `language: ${input.language}`,
        `calendar: ${input.calendar}`,
        `open_access: ${input.open_access}`,
      ].join("\n");

      if (!input.confirm) {
        return okText(
          [
            "PREVIEW — nothing has been created. All conflict checks passed (DNS, wb config, nginx, SSL, servers.json, volume directory).",
            "",
            "Would create with this config:",
            configSummary,
            "",
            "Steps that will run, in order (stops at the first failure, leaving earlier steps in place):",
            "1. Create DNS A record  2. Add to wb config + set volume  3. Init directories  4. Init nginx  5. Init SSL certificate (Let's Encrypt)  6. Set label  7. Apply language/calendar/open-access/category  8. Start the container",
            "",
            "Show this preview to the user. Re-call with confirm:true ONLY after they explicitly approve.",
          ].join("\n"),
        );
      }

      // ---- execute (mirrors CreateServerModal.tsx handleCreate ordering) ----
      if (createInProgress) {
        return errText(
          "Another server creation is already in progress — wait for it to finish and re-check the fleet before retrying.",
        );
      }
      createInProgress = true;
      try {
        const completed: string[] = [];
        const fail = (step: string, detail: string) =>
          errText(
            [
              `FAILED at "${step}": ${detail}`,
              completed.length
                ? `Steps already completed (left in place, same as the admin UI): ${completed.join(" → ")}`
                : "No steps had completed — nothing was created.",
              "Report this to the user before any retry or cleanup.",
            ].join("\n"),
          );

        // 1. DNS A record (DigitalOcean)
        const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
        if (!doToken) throw new ToolFailure("DigitalOcean API token not configured");
        const dnsResponse = await fetch(
          "https://api.digitalocean.com/v2/domains/fastr-analytics.org/records",
          {
            method: "POST",
            headers: { "Authorization": `Bearer ${doToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ type: "A", name: serverId, data: getDropletIp(), ttl: 3600 }),
          },
        );
        if (!dnsResponse.ok) {
          const err = await dnsResponse.json().catch(() => ({}));
          return fail("Create DNS record", (err as { message?: string }).message ?? `HTTP ${dnsResponse.status}`);
        }
        completed.push("DNS record");

        // 2. wb config entry + volume placement (before init-dirs so the
        // directories land on the right volume)
        const add = await runWb(`wb c add ${serverId}`);
        if (!add.success) return fail("Add to wb config", add.detail);
        const vol = await runWb(`wb c update ${serverId} --volume ${volume}`);
        if (!vol.success) return fail("Set volume", vol.detail);
        completed.push("wb config + volume");

        // 3–5. dirs, nginx, SSL
        for (const [step, command] of [
          ["Init directories", `wb init-dirs ${serverId}`],
          ["Init nginx", `wb init-nginx ${serverId}`],
          ["Init SSL", `wb init-ssl ${serverId}`],
        ] as const) {
          const result = await runWb(command);
          if (!result.success) return fail(step, result.detail);
          completed.push(step);
        }

        // 6. label
        const labelResult = await runWb(`wb c update ${serverId} --label "${label}"`);
        if (!labelResult.success) return fail("Set label", labelResult.detail);
        completed.push("label");

        // 7. config. Country FIRST — the container boot fail-stops without
        // it, so it must be set before "wb run". Language sets BOTH flags
        // (mutually exclusive, kept coherent, same as the update/language
        // route); calendar/open-access only when non-default, same as the
        // modal.
        const country = await runWb(`wb c update ${serverId} --country-iso3 ${input.country_iso3}`);
        if (!country.success) return fail("Set country", country.detail);
        if (input.language !== "english") {
          for (const command of [
            `wb c update ${serverId} --french ${input.language === "french"}`,
            `wb c update ${serverId} --portuguese ${input.language === "portuguese"}`,
          ]) {
            const result = await runWb(command);
            if (!result.success) return fail("Set language", result.detail);
          }
        }
        if (input.calendar === "ethiopian") {
          const result = await runWb(`wb c update ${serverId} --ethiopian true`);
          if (!result.success) return fail("Set calendar", result.detail);
        }
        if (input.open_access) {
          const result = await runWb(`wb c update ${serverId} --open-access true`);
          if (!result.success) return fail("Set open access", result.detail);
        }
        if (input.category !== undefined) {
          await assignServerToCategory(serverId, input.category);
        }
        completed.push("config");

        // 8. start the container
        const run = await runWb(`wb run ${serverId}`);
        if (!run.success) return fail("Start container", run.detail);
        completed.push("container started");

        return okText(
          [
            `Created and started "${serverId}" — all 8 steps succeeded.`,
            "",
            configSummary,
            "",
            `The instance is coming up at https://${serverId}.fastr-analytics.org — give it a minute, then verify with get_server_status (server_id: ${serverId}).`,
          ].join("\n"),
        );
      } finally {
        createInProgress = false;
      }
    }));
}
