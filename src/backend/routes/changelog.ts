/// <reference lib="deno.ns" />
import { Hono } from "hono";

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

router.get("/changelog", async (c) => {
  const text = await readChangelogAuto();
  return text ? c.text(text) : c.text("", 404);
});

export default router;
