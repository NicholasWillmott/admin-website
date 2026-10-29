/// <reference lib="deno.ns" />
// Fill-missing snapshot of country module-defaults baselines (contract in
// lib/module_defaults.ts). Adds every v2 country that has no baseline entry
// yet and NEVER touches an existing one: baselines are frozen. Re-run it
// after a v1 country upgrades to v2. Run through ./snapshot_module_defaults.
//
// Dry run unless --commit is passed. Needs STATUS_API_KEY (to read each
// instance) and, for --commit, GITHUB_PAT_RESOURCE_HUB (contents write on
// fastr-resource-hub).

import {
  type BaselineFile,
  commitBaselineFile,
  fetchBaselineFile,
  fetchRegistry,
  fetchSnapshot,
  isCountryInstance,
  isV2,
  readBaselineFileForWrite,
  toBaselineEntry,
} from "./lib/module_defaults.ts";
import { mapConcurrent } from "./mcp/tools/helpers.ts";

const commit = Deno.args.includes("--commit");
const statusApiKey = Deno.env.get("STATUS_API_KEY");
const githubToken = Deno.env.get("GITHUB_PAT_RESOURCE_HUB");

if (!statusApiKey) {
  console.error("STATUS_API_KEY is not set.");
  Deno.exit(1);
}
if (commit && !githubToken) {
  console.error("--commit needs GITHUB_PAT_RESOURCE_HUB.");
  Deno.exit(1);
}

const { file: current, sha } = commit && githubToken
  ? await readBaselineFileForWrite(githubToken)
  : { file: await fetchBaselineFile(), sha: undefined };
const existing = current?.countries ?? {};

const registry = await fetchRegistry();
const countries = registry.filter(isCountryInstance);
const skippedV1 = countries.filter((s) => !isV2(s));
const candidates = countries.filter((s) => isV2(s) && !(s.id in existing));

console.log(
  `${Object.keys(existing).length} countries already have a baseline (left untouched).`,
);
if (skippedV1.length > 0) {
  console.log(
    `Not on v2 yet, skipped: ${
      skippedV1.map((s) => `${s.id} (${s.serverVersion})`).join(", ")
    }`,
  );
}
if (candidates.length === 0) {
  console.log("Nothing to add.");
  Deno.exit(0);
}

const snapshotAt = new Date().toISOString();
const results = await mapConcurrent(candidates, 6, async (server) => {
  try {
    const snapshot = await fetchSnapshot(server.id, statusApiKey);
    if (snapshot.instanceId !== server.id) {
      throw new Error(
        `answered as instance "${snapshot.instanceId}", not "${server.id}"`,
      );
    }
    return { server, entry: toBaselineEntry(server, snapshot, snapshotAt) };
  } catch (error) {
    return { server, error: String(error) };
  }
});

const added = results.flatMap((r) => r.entry ? [r] : []);
const failed = results.flatMap((r) => r.error ? [r] : []);

for (const r of added) {
  const e = r.entry!;
  const pinned = Object.values(e.stored.parameterSelections)
    .reduce((n, m) => n + Object.keys(m).length, 0);
  console.log(
    `+ ${r.server.id.padEnd(14)} v${e.platformVersion}  ${e.stored.moduleIds.length} modules pre-selected, ${pinned} params pinned`,
  );
}
for (const r of failed) {
  console.log(`! ${r.server.id.padEnd(14)} ${r.error}`);
}

if (added.length === 0) {
  console.log("No snapshots succeeded; nothing to write.");
  Deno.exit(failed.length > 0 ? 1 : 0);
}

const next: BaselineFile = {
  version: 1,
  countries: {
    ...existing,
    ...Object.fromEntries(added.map((r) => [r.server.id, r.entry!])),
  },
};

if (!commit) {
  console.log(
    `\nDry run: would add ${added.length} countr${
      added.length === 1 ? "y" : "ies"
    }. Re-run with --commit to write module_defaults_baseline.json.`,
  );
  Deno.exit(failed.length > 0 ? 1 : 0);
}

const url = await commitBaselineFile(
  next,
  sha,
  `Module-defaults baseline: add ${added.map((r) => r.server.id).join(", ")}`,
  githubToken!,
);
console.log(`\nCommitted: ${url}`);
Deno.exit(failed.length > 0 ? 1 : 0);
