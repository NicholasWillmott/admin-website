/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { parseFullChangelog, readChangelogAuto } from "../../routes/changelog.ts";
import { readPosts, type WhatsNewPost } from "../../routes/whatsnew.ts";
import { okJson, runTool, ToolFailure } from "./helpers.ts";

// Content tools: the platform changelog (fetched from GitHub) and What's New
// posts (posts.json on the droplet volume).

// Version sort for posts — same semantics as the whatsnew.ts route's local
// compareVersions (not exported there; three lines to redo)
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function registerContentTools(server: McpServer): void {
  server.registerTool("get_changelog", {
    title: "Platform changelog",
    description:
      "The FASTR platform changelog, parsed and grouped by version, change type, and audience. Newest versions first.",
    inputSchema: z.object({
      limit_versions: z.number().int().min(1).max(100).default(10),
    }),
    annotations: { readOnlyHint: true },
  }, ({ limit_versions }) =>
    runTool(async () => {
      const text = await readChangelogAuto();
      if (!text) {
        throw new ToolFailure("Changelog unavailable (GitHub fetch failed).");
      }
      return okJson({ versions: parseFullChangelog(text).slice(0, limit_versions) });
    }));

  server.registerTool("get_whats_new_posts", {
    title: "What's New posts",
    description:
      "What's New posts shown to platform users, newest version first. By default only live posts (published and past any scheduled publishAt); include_drafts adds drafts and scheduled posts. Text content only — media appears as URLs.",
    inputSchema: z.object({
      include_drafts: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: true },
  }, ({ include_drafts }) =>
    runTool(async () => {
      const posts = await readPosts();
      const now = Date.now();
      const isLive = (p: WhatsNewPost) =>
        p.published && (!p.publishAt || Date.parse(p.publishAt) <= now);
      const selected = (include_drafts ? posts : posts.filter(isLive))
        .sort((a, b) => compareVersions(b.version, a.version));
      return okJson({
        posts: selected.map((p) => ({
          id: p.id,
          version: p.version,
          title: p.title,
          adminsOnly: p.adminsOnly,
          published: p.published,
          publishAt: p.publishAt ?? null,
          live: isLive(p),
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          pages: p.pages,
        })),
      });
    }));
}
