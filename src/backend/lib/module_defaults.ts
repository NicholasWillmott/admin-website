/// <reference lib="deno.ns" />
import { Octokit } from "@octokit/rest";

// Country module-defaults baselines. Each v2 country's module defaults (the
// platform's `run_generation_defaults` store) were frozen once into
// module_defaults_baseline.json in the public resource hub. The platform's
// module-defaults editor marks and resets drift against it; this site shows
// every country's live values beside it (routes/moduleDefaults.ts) and owns
// the only writer, the fill-missing snapshot script
// (snapshot_module_defaults.ts), which adds countries and never overwrites
// one. Shapes mirror the platform's ModuleDefaultsSnapshotResponse and
// ModuleDefaultsBaselineFile in lib/types/run_generation.ts.

export const RESOURCE_HUB_OWNER = "FASTR-Analytics";
export const RESOURCE_HUB_REPO = "fastr-resource-hub";
export const BASELINE_PATH = "module_defaults_baseline.json";
const BASELINE_RAW_URL =
  `https://raw.githubusercontent.com/${RESOURCE_HUB_OWNER}/${RESOURCE_HUB_REPO}/refs/heads/main/${BASELINE_PATH}`;

const SNAPSHOT_TIMEOUT_MS = 30_000;

export interface RegistryServerLite {
  id: string;
  label: string;
  serverVersion: string;
  countryIso3?: string | null;
  french?: boolean;
}

export interface StoredModuleDefaults {
  step1: { hmis: boolean; hfa: boolean; iceh: boolean } | null;
  moduleIds: string[];
  parameterSelections: Record<string, Record<string, string>>;
}

export interface ModuleDefaultsSnapshot {
  instanceId: string;
  platformVersion: string;
  modulesGitRef: string;
  stored: StoredModuleDefaults;
  effective: Record<string, Record<string, string>>;
}

export interface SnapshotModuleDefinition {
  id: string;
  label: string;
  parameters: {
    replacementString: string;
    description: string;
    defaultValue: string;
  }[];
}

export type ModuleDefaultsSnapshotResponse = ModuleDefaultsSnapshot & {
  modules: SnapshotModuleDefinition[];
};

export interface BaselineEntry extends ModuleDefaultsSnapshot {
  label: string;
  iso3: string | null;
  snapshotAt: string;
}

export interface BaselineFile {
  version: 1;
  countries: Record<string, BaselineEntry>;
}

// Demo and test instances are not countries: never baselined, never shown.
export function isCountryInstance(server: RegistryServerLite): boolean {
  return !server.id.includes("test") && !server.id.startsWith("demo");
}

// The module-defaults store and snapshot route exist from v2 on.
export function isV2(server: RegistryServerLite): boolean {
  return /^([2-9]|\d{2,})\./.test(server.serverVersion);
}

export async function fetchRegistry(): Promise<RegistryServerLite[]> {
  const res = await fetch("https://central.fastr-analytics.org/servers.json", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`servers.json answered ${res.status}`);
  return await res.json();
}

export async function fetchSnapshot(
  serverId: string,
  statusApiKey: string,
): Promise<ModuleDefaultsSnapshotResponse> {
  const res = await fetch(
    `https://${serverId}.fastr-analytics.org/module_defaults_snapshot`,
    {
      headers: { "status-api-key": statusApiKey },
      signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${serverId} answered ${res.status} ${body.slice(0, 200)}`);
  }
  return await res.json();
}

// The published file, read the way the platform reads it (raw, uncached).
// null = no file yet; a file that is there but malformed throws, so the
// script can never "fill" over it.
export async function fetchBaselineFile(): Promise<BaselineFile | null> {
  const res = await fetch(`${BASELINE_RAW_URL}?t=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`baseline file answered ${res.status}`);
  return parseBaselineFile(await res.json());
}

export function toBaselineEntry(
  server: RegistryServerLite,
  snapshot: ModuleDefaultsSnapshotResponse,
  snapshotAt: string,
): BaselineEntry {
  return {
    label: server.label,
    iso3: server.countryIso3 ?? null,
    snapshotAt,
    instanceId: snapshot.instanceId,
    platformVersion: snapshot.platformVersion,
    modulesGitRef: snapshot.modulesGitRef,
    stored: snapshot.stored,
    effective: snapshot.effective,
  };
}

function parseBaselineFile(data: unknown): BaselineFile {
  const d = data as { version?: unknown; countries?: unknown };
  if (d?.version !== 1 || typeof d.countries !== "object" || !d.countries) {
    throw new Error("baseline file is not version 1");
  }
  return data as BaselineFile;
}

// The writer's read: through the contents API (no CDN lag), with the sha the
// commit must name. null file = none committed yet.
export async function readBaselineFileForWrite(
  token: string,
): Promise<{ file: BaselineFile | null; sha: string | undefined }> {
  const octokit = new Octokit({ auth: token });
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: RESOURCE_HUB_OWNER,
      repo: RESOURCE_HUB_REPO,
      path: BASELINE_PATH,
    });
    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`${BASELINE_PATH} is not a file`);
    }
    const binary = atob(data.content.replace(/\n/g, ""));
    const text = new TextDecoder().decode(
      Uint8Array.from(binary, (ch) => ch.charCodeAt(0)),
    );
    return { file: parseBaselineFile(JSON.parse(text)), sha: data.sha };
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return { file: null, sha: undefined };
    }
    throw error;
  }
}

// Commit the whole file. Naming the sha that was read makes a concurrent
// writer fail this commit rather than be overwritten by it.
export async function commitBaselineFile(
  file: BaselineFile,
  sha: string | undefined,
  message: string,
  token: string,
): Promise<string> {
  const octokit = new Octokit({ auth: token });
  const bytes = new TextEncoder().encode(JSON.stringify(file, null, 2) + "\n");
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner: RESOURCE_HUB_OWNER,
    repo: RESOURCE_HUB_REPO,
    path: BASELINE_PATH,
    message,
    content: btoa(binary),
    sha,
  });
  return data.commit.html_url ?? data.commit.sha ?? "";
}
