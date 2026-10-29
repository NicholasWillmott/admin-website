/// <reference lib="deno.ns" />
// Computes the fleet's global module parameter defaults (contract in
// lib/module_defaults.ts): the most common value per parameter across every
// v2 country, from each instance's /module_defaults_snapshot. Prints the
// result. --commit publishes module_defaults_global.json to fastr-resource-hub
// through the GitHub API; --out <path> writes it locally instead. Run through
// ./compute_module_defaults_global.
//
// The published file is frozen, so publishing or writing refuses when one is
// already published unless --replace. A partial count would skew the result,
// so both also refuse when any v2 country could not be read.
//
// Needs the PRODUCTION STATUS_API_KEY in the environment; the backend .env
// holds a dev key, so it is deliberately not read from there. --commit needs
// GITHUB_PAT_RESOURCE_HUB (Contents read and write on fastr-resource-hub),
// from the environment or the backend .env.

import { load } from "@std/dotenv";
import {
  commitGlobalFile,
  computeGlobalParameters,
  fetchGlobalFile,
  fetchRegistry,
  fetchSnapshot,
  isCountryInstance,
  isV2,
  type ModuleDefaultsSnapshot,
  readGlobalFileSha,
  toGlobalFile,
} from "./lib/module_defaults.ts";
import { mapConcurrent } from "./mcp/tools/helpers.ts";

function argValue(name: string): string | undefined {
  const i = Deno.args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i === -1) return undefined;
  const a = Deno.args[i];
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : Deno.args[i + 1];
}

const outPath = argValue("--out");
const commit = Deno.args.includes("--commit");
const replace = Deno.args.includes("--replace");
const statusApiKey = Deno.env.get("STATUS_API_KEY");
if (!statusApiKey) {
  console.error("STATUS_API_KEY is not set.");
  Deno.exit(1);
}
const githubToken = Deno.env.get("GITHUB_PAT_RESOURCE_HUB") ??
  (await load()).GITHUB_PAT_RESOURCE_HUB;
if (commit && !githubToken) {
  console.error(
    "--commit needs GITHUB_PAT_RESOURCE_HUB, in the environment or src/backend/.env.",
  );
  Deno.exit(1);
}

const registry = await fetchRegistry();
const countries = registry.filter(isCountryInstance);
const v1 = countries.filter((s) => !isV2(s));
const v2 = countries.filter(isV2);
if (v1.length > 0) {
  console.log(
    `Not on v2, not counted: ${
      v1.map((s) => `${s.id} (${s.serverVersion})`).join(", ")
    }`,
  );
}

const results = await mapConcurrent(v2, 6, async (server) => {
  try {
    return { server, snapshot: await fetchSnapshot(server.id, statusApiKey) };
  } catch (error) {
    return { server, error: String(error) };
  }
});
const failed = results.filter((r) => r.error);
const snapshots = results.flatMap((r) =>
  r.snapshot ? [{ id: r.server.id, snapshot: r.snapshot }] : []
);
for (const r of failed) console.log(`! ${r.server.id}: ${r.error}`);
console.log(`Counted ${snapshots.length} of ${v2.length} v2 countries.\n`);
if (snapshots.length === 0) Deno.exit(1);

const computed = computeGlobalParameters(
  snapshots.map((s) => s.snapshot as ModuleDefaultsSnapshot),
);

// Labels from an English-language instance when there is one.
const englishIds = new Set(v2.filter((s) => !s.french).map((s) => s.id));
const labelSource =
  (snapshots.find((s) => englishIds.has(s.id)) ?? snapshots[0]).snapshot;
const moduleLabel = (id: string) =>
  labelSource.modules.find((m) => m.id === id)?.label ?? id;

let total = 0;
let fromDefinition = 0;
let ties = 0;
for (const [mod, byKey] of Object.entries(computed)) {
  console.log(`${moduleLabel(mod)} (${mod})`);
  for (const [key, c] of Object.entries(byKey)) {
    total++;
    const notes: string[] = [];
    if (c.value !== c.definitionDefault) {
      fromDefinition++;
      notes.push(`definition default is ${c.definitionDefault}`);
    }
    if (c.tie) {
      ties++;
      notes.push(
        `TIE: ${
          Object.entries(c.distribution).map(([v, n]) => `${v}×${n}`).join(", ")
        }`,
      );
    } else if (c.agreeing < c.counted) {
      notes.push(
        `others: ${
          Object.entries(c.distribution).filter(([v]) => v !== c.value)
            .map(([v, n]) => `${v}×${n}`).join(", ")
        }`,
      );
    }
    console.log(
      `  ${key.padEnd(32)} ${c.value.padEnd(14)} ${c.agreeing}/${c.counted}${
        notes.length ? `   ${notes.join("; ")}` : ""
      }`,
    );
  }
  console.log("");
}
console.log(
  `${total} parameters: ${fromDefinition} differ from their definition default, ${ties} tie${
    ties === 1 ? "" : "s"
  }.`,
);

if (!outPath && !commit) {
  console.log(
    "\nNothing written. Pass --commit to publish it, or --out <path> to write it locally.",
  );
  Deno.exit(0);
}
if (failed.length > 0) {
  console.error(
    `\nNot writing: ${failed.length} v2 countr${
      failed.length === 1 ? "y" : "ies"
    } could not be read, so the count is incomplete.`,
  );
  Deno.exit(1);
}
// The commit path checks through the contents API (authoritative, and its
// sha guards the commit); the local path through the raw file.
const publishedSha = commit ? await readGlobalFileSha(githubToken!) : undefined;
const published = commit
  ? publishedSha !== undefined
  : (await fetchGlobalFile()) !== null;
if (published && !replace) {
  console.error(
    "\nNot writing: module_defaults_global.json is already published and frozen. Pass --replace to recompute it deliberately.",
  );
  Deno.exit(1);
}

const file = toGlobalFile(
  snapshots.map((s) => s.id),
  computed,
  new Date().toISOString(),
);
if (outPath) {
  await Deno.writeTextFile(outPath, JSON.stringify(file, null, 2) + "\n");
  console.log(`\nWrote ${outPath}.`);
}
if (commit) {
  const url = await commitGlobalFile(
    file,
    publishedSha,
    `Module defaults: ${
      published ? "recompute" : "publish"
    } global parameter defaults from ${snapshots.length} countries`,
    githubToken!,
  );
  console.log(`\nPublished: ${url}`);
} else {
  console.log(
    "Commit it to the root of fastr-resource-hub (main) to publish it.",
  );
}
