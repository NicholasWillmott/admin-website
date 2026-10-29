/// <reference lib="deno.ns" />

// The fleet's global module parameter defaults. For each module parameter,
// the value most v2 countries had when it was computed, frozen into
// module_defaults_global.json in the public resource hub. Parameters only:
// default families and pre-selected modules stay each country's own choice.
// The platform's module-defaults editor marks and resets params that differ
// from it; this site shows every country's live values beside it
// (routes/moduleDefaults.ts) and computes it (compute_module_defaults_global.ts,
// which writes the file for a person to commit). Shapes mirror the platform's
// ModuleDefaultsSnapshot and ModuleDefaultsGlobalFile in
// lib/types/run_generation.ts.

const RESOURCE_HUB_RAW =
  "https://raw.githubusercontent.com/FASTR-Analytics/fastr-resource-hub/refs/heads/main";
export const GLOBAL_FILE_NAME = "module_defaults_global.json";

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

export interface GlobalParam {
  value: string;
  agreeing: number;
  counted: number;
}

export interface GlobalFile {
  version: 1;
  computedAt: string;
  countries: string[];
  parameters: Record<string, Record<string, GlobalParam>>;
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

// The published file, read the way the platform reads it (raw, uncached).
// null = not published yet.
export async function fetchGlobalFile(): Promise<GlobalFile | null> {
  const res = await fetch(
    `${RESOURCE_HUB_RAW}/${GLOBAL_FILE_NAME}?t=${Date.now()}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`global defaults file answered ${res.status}`);
  const data = await res.json();
  if (
    data?.version !== 1 || typeof data.parameters !== "object" ||
    !data.parameters
  ) {
    throw new Error("global defaults file is not version 1");
  }
  return data as GlobalFile;
}

export interface ComputedParam extends GlobalParam {
  definitionDefault: string;
  distribution: Record<string, number>;
  tie: boolean;
}

type Tally = Map<string, Map<string, Map<string, number>>>;

function bump(t: Tally, mod: string, key: string, value: string): void {
  if (!t.has(mod)) t.set(mod, new Map());
  const byKey = t.get(mod)!;
  if (!byKey.has(key)) byKey.set(key, new Map());
  const counts = byKey.get(key)!;
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function topValues(counts: Map<string, number>): { max: number; tied: string[] } {
  const max = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, n]) => n === max).map(([v]) => v)
    .sort();
  return { max, tied };
}

// The most common effective value per param across the given countries,
// counting only countries that offer the param. A tie goes to the definition
// default when it is among the tied values, else to the lowest value in sort
// order, and is reported so a person can decide before committing.
export function computeGlobalParameters(
  snapshots: ModuleDefaultsSnapshot[],
): Record<string, Record<string, ComputedParam>> {
  const values: Tally = new Map();
  const definitionDefaults: Tally = new Map();
  for (const s of snapshots) {
    for (const m of s.modules) {
      for (const param of m.parameters) {
        const value = s.effective[m.id]?.[param.replacementString];
        if (value === undefined) continue;
        bump(values, m.id, param.replacementString, value);
        bump(definitionDefaults, m.id, param.replacementString, param.defaultValue);
      }
    }
  }

  const out: Record<string, Record<string, ComputedParam>> = {};
  for (const [mod, byKey] of values) {
    out[mod] = {};
    for (const [key, counts] of byKey) {
      const definitionDefault = topValues(definitionDefaults.get(mod)!.get(key)!)
        .tied[0];
      const { max, tied } = topValues(counts);
      out[mod][key] = {
        value: tied.includes(definitionDefault) ? definitionDefault : tied[0],
        agreeing: max,
        counted: [...counts.values()].reduce((a, b) => a + b, 0),
        definitionDefault,
        distribution: Object.fromEntries(counts),
        tie: tied.length > 1,
      };
    }
  }
  return out;
}

export function toGlobalFile(
  countries: string[],
  computed: Record<string, Record<string, ComputedParam>>,
  computedAt: string,
): GlobalFile {
  return {
    version: 1,
    computedAt,
    countries: [...countries].sort(),
    parameters: Object.fromEntries(
      Object.entries(computed).map(([mod, byKey]) => [
        mod,
        Object.fromEntries(
          Object.entries(byKey).map(([key, c]) => [
            key,
            { value: c.value, agreeing: c.agreeing, counted: c.counted },
          ]),
        ),
      ]),
    ),
  };
}
