/// <reference lib="deno.ns" />

// Module defaults across the fleet. The one shared default for each module
// parameter is its `defaultValue` in the module's definition.json. The
// platform's module-defaults editor marks and resets params that differ from
// it; this site shows every country's live values against it
// (routes/moduleDefaults.ts), read from each instance's
// /module_defaults_snapshot. Shapes mirror the platform's
// ModuleDefaultsSnapshot in lib/types/run_generation.ts.

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
  modules: {
    id: string;
    label: string;
    parameters: {
      replacementString: string;
      description: string;
      defaultValue: string;
    }[];
  }[];
}

// Demo and test instances are not countries: never counted, never shown.
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
): Promise<ModuleDefaultsSnapshot> {
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
