/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdminOrInternal } from "../lib/auth.ts";

const router = new Hono();

const CHANGELOG_URL =
  "https://raw.githubusercontent.com/FASTR-Analytics/platform/main/CHANGELOG_AUTO.txt";

export async function readChangelogAuto(): Promise<string> {
  const headers: Record<string, string> = { "Accept": "text/plain" };
  const pat = Deno.env.get("GITHUB_PAT_PLATFORM");
  if (pat) headers["Authorization"] = `Bearer ${pat}`;
  const res = await fetch(CHANGELOG_URL, { headers });
  if (!res.ok) return "";
  return res.text();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface ParsedChangelogItem {
  desc: string;
  audience: string;
}

interface ParsedChangelogTypeGroup {
  type: string;
  items: ParsedChangelogItem[];
}

interface ParsedChangelogVersion {
  version: string;
  types: ParsedChangelogTypeGroup[];
}

function parseFullChangelog(text: string): ParsedChangelogVersion[] {
  const lines = text.split("\n").filter(l => l.trim().startsWith("["));
  const parsed = lines.map(line => {
    const m = line.match(/^\[([^\]]+)\] \[([^\]]+)\] \[([^\]]+)\] - (.+)$/);
    if (!m || m[1] === "TBD") return null;
    return { version: m[1], audience: m[2], type: m[3], desc: m[4] };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const byVersion = new Map<string, Map<string, ParsedChangelogItem[]>>();
  for (const { version, audience, type, desc } of parsed) {
    if (!byVersion.has(version)) byVersion.set(version, new Map());
    const byType = byVersion.get(version)!;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push({ desc, audience });
  }

  const sortedVersions = [...byVersion.keys()].sort((a, b) => compareVersions(b, a));
  return sortedVersions.map(version => ({
    version,
    types: [...byVersion.get(version)!.entries()].map(([type, items]) => ({ type, items })),
  }));
}

router.get("/changelog", async (c) => {
  const text = await readChangelogAuto();
  return text ? c.text(text) : c.text("", 404);
});

router.get("/parsed", async (c) => {
  const authError = await requireAdminOrInternal(c);
  if (authError) return authError;
  const text = await readChangelogAuto();
  if (!text) return c.json({ versions: [] });
  return c.json({ versions: parseFullChangelog(text) });
});

export default router;
