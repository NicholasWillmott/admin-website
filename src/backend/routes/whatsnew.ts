/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";

const router = new Hono();

const WHATS_NEW_DIR = "/mnt/fastr-config/whats-new";
const POSTS_FILE = `${WHATS_NEW_DIR}/posts.json`;
const IMAGES_DIR = `${WHATS_NEW_DIR}/images`;
const PUBLIC_API_BASE = Deno.env.get("PUBLIC_API_BASE") ?? "https://status-api.fastr-analytics.org";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 20_000;
const MAX_PAGES = 20;
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const ALLOWED_UPLOAD_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const LAYOUT_PRESETS = ["textOnly", "heroTop", "imageLeft", "imageRight", "imageBottom", "cover"] as const;
type WhatsNewLayoutPreset = (typeof LAYOUT_PRESETS)[number];

// English required; fr/pt fall back to English in the platform when absent
interface WhatsNewText {
  en: string;
  fr?: string;
  pt?: string;
}

interface WhatsNewPage {
  title?: WhatsNewText;
  body: WhatsNewText;
  imageUrl?: string; // required for image presets
  imageAlt?: WhatsNewText;
  layoutPreset: WhatsNewLayoutPreset;
}

interface WhatsNewPost {
  id: string;
  version: string;
  title: WhatsNewText;
  pages: WhatsNewPage[];
  adminsOnly: boolean;
  published: boolean;
  publishAt?: string; // ISO; when set, public feed includes the post only after this time
  createdAt: string;
  updatedAt: string;
}

// Posts stored before the multi-language change have plain-string text fields
function normalizeText(v: unknown): WhatsNewText {
  if (typeof v === "string") return { en: v };
  if (v && typeof v === "object") return v as WhatsNewText;
  return { en: String(v ?? "") };
}

// Pages stored before layout presets have imagePosition/imageWidth instead
// of layoutPreset — map to the nearest preset and drop the old fields
function normalizeLayout(page: WhatsNewPage & { imagePosition?: string; imageWidth?: number }): WhatsNewLayoutPreset {
  if (page.layoutPreset && LAYOUT_PRESETS.includes(page.layoutPreset)) return page.layoutPreset;
  if (!page.imageUrl) return "textOnly";
  switch (page.imagePosition) {
    case "left": return "imageLeft";
    case "right": return "imageRight";
    case "bottom": return "imageBottom";
    default: return "heroTop";
  }
}

function normalizePost(p: WhatsNewPost): WhatsNewPost {
  return {
    ...p,
    title: normalizeText(p.title),
    pages: (p.pages ?? []).map((page) => {
      const { imagePosition: _pos, imageWidth: _w, ...rest } = page as WhatsNewPage & { imagePosition?: string; imageWidth?: number };
      return {
        ...rest,
        ...(page.title !== undefined ? { title: normalizeText(page.title) } : {}),
        ...(page.imageAlt !== undefined ? { imageAlt: normalizeText(page.imageAlt) } : {}),
        body: normalizeText(page.body),
        layoutPreset: normalizeLayout(page as WhatsNewPage & { imagePosition?: string }),
      };
    }),
  };
}

// A missing file is legitimately "no posts yet"; anything else (corrupt JSON,
// permission errors) must THROW — returning [] here would let the next save
// silently overwrite every post.
async function readPosts(): Promise<WhatsNewPost[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(POSTS_FILE);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  const posts: WhatsNewPost[] = JSON.parse(text).posts ?? [];
  return posts.map(normalizePost);
}

// Atomic: write to a temp file, then rename over the live one, so a crash
// mid-write can never leave a truncated posts.json
async function writePosts(posts: WhatsNewPost[]): Promise<void> {
  await Deno.mkdir(WHATS_NEW_DIR, { recursive: true });
  const tmp = `${POSTS_FILE}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify({ posts }, null, 2));
  await Deno.rename(tmp, POSTS_FILE);
}

// Serializes read-modify-write cycles so concurrent admin edits can't lose
// each other's updates
let postsMutex: Promise<void> = Promise.resolve();
function withPostsLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = postsMutex.then(fn);
  postsMutex = result.then(() => undefined, () => undefined);
  return result;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  const pb = b.split(".").map((s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Validates a {en, fr?, pt?} text field. English is required when
// `required`, or when any other language is present (it is the fallback).
// Returns the cleaned text, null when the field is entirely empty, or an
// error. Bodies are not trimmed (leading whitespace is meaningful markdown).
function cleanText(
  v: unknown,
  label: string,
  opts: { required: boolean; trim: boolean; maxLen: number },
): { text: WhatsNewText | null } | { error: string } {
  const raw = typeof v === "string" ? { en: v } : v;
  if (raw === undefined || raw === null) {
    return opts.required ? { error: `${label} is required` } : { text: null };
  }
  const t = raw as Partial<WhatsNewText>;
  if (typeof t !== "object") return { error: `Invalid ${label}` };
  for (const lang of ["en", "fr", "pt"] as const) {
    if (t[lang] !== undefined && typeof t[lang] !== "string") return { error: `Invalid ${label}` };
    if (t[lang] !== undefined && t[lang]!.length > opts.maxLen) {
      return { error: `${label} is too long (max ${opts.maxLen} characters)` };
    }
  }
  const en = opts.trim ? t.en?.trim() : t.en;
  const fr = opts.trim ? t.fr?.trim() : t.fr;
  const pt = opts.trim ? t.pt?.trim() : t.pt;
  if (!en?.trim()) {
    if (fr?.trim() || pt?.trim()) return { error: `${label} needs an English version (it is the fallback)` };
    return opts.required ? { error: `${label} is required` } : { text: null };
  }
  return {
    text: {
      en,
      ...(fr?.trim() ? { fr } : {}),
      ...(pt?.trim() ? { pt } : {}),
    },
  };
}

function validatePostInput(body: unknown): { error: string } | { post: Omit<WhatsNewPost, "id" | "createdAt" | "updatedAt"> } {
  const b = body as Partial<WhatsNewPost> | null;
  if (!b || typeof b !== "object") return { error: "Invalid body" };
  const titleResult = cleanText(b.title, "Title", { required: true, trim: true, maxLen: MAX_TITLE_LEN });
  if ("error" in titleResult) return titleResult;
  const title = titleResult.text!;
  const version = typeof b.version === "string" ? b.version.trim() : "";
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { error: "Version must be in the form 1.62.0" };
  let publishAt: string | undefined;
  if (b.publishAt !== undefined && b.publishAt !== null && b.publishAt !== "") {
    if (typeof b.publishAt !== "string" || Number.isNaN(Date.parse(b.publishAt))) {
      return { error: "Invalid publish date" };
    }
    publishAt = new Date(b.publishAt).toISOString();
  }
  if (!Array.isArray(b.pages) || b.pages.length === 0) return { error: "At least one page is required" };
  if (b.pages.length > MAX_PAGES) return { error: `Too many pages (max ${MAX_PAGES})` };
  const pages: WhatsNewPage[] = [];
  for (const raw of b.pages) {
    const page = raw as Partial<WhatsNewPage> | null;
    if (!page || typeof page !== "object") return { error: "Invalid page" };
    const bodyResult = cleanText(page.body, "Page body", { required: true, trim: false, maxLen: MAX_BODY_LEN });
    if ("error" in bodyResult) return bodyResult;
    const titleRes = cleanText(page.title, "Page heading", { required: false, trim: true, maxLen: MAX_TITLE_LEN });
    if ("error" in titleRes) return titleRes;
    const altRes = cleanText(page.imageAlt, "Image description", { required: false, trim: true, maxLen: MAX_TITLE_LEN });
    if ("error" in altRes) return altRes;
    if (!page.layoutPreset || !LAYOUT_PRESETS.includes(page.layoutPreset)) {
      return { error: "Invalid page layout" };
    }
    if (page.imageUrl !== undefined && typeof page.imageUrl !== "string") return { error: "Invalid image URL" };
    const needsImage = page.layoutPreset !== "textOnly";
    if (needsImage && !page.imageUrl) {
      return { error: "Image layouts need an uploaded image — upload one or choose Text only" };
    }
    pages.push({
      ...(titleRes.text ? { title: titleRes.text } : {}),
      body: bodyResult.text!,
      layoutPreset: page.layoutPreset,
      ...(needsImage ? { imageUrl: page.imageUrl } : {}),
      ...(needsImage && altRes.text ? { imageAlt: altRes.text } : {}),
    });
  }
  return {
    post: {
      title,
      version,
      pages,
      adminsOnly: b.adminsOnly === true,
      published: b.published === true,
      ...(publishAt ? { publishAt } : {}),
    },
  };
}

function imageFilenamesOf(post: WhatsNewPost): string[] {
  const names: string[] = [];
  for (const page of post.pages) {
    const filename = page.imageUrl?.split("/api/whats-new/images/")[1];
    if (filename && /^[A-Za-z0-9-]+\.[a-z]+$/.test(filename)) names.push(filename);
  }
  return names;
}

async function deleteImageFiles(filenames: Iterable<string>): Promise<void> {
  for (const filename of filenames) {
    try {
      await Deno.remove(`${IMAGES_DIR}/${filename}`);
    } catch {
      // already gone — ignore
    }
  }
}

// Daily cleanup of uploaded images no post references (uploaded-then-never-
// saved, or removed from a page). Files younger than 24h are spared so
// in-progress drafts don't lose their uploads. Never sweeps against a failed
// read — an unreadable posts.json must not trigger mass deletion.
async function sweepOrphanImages(): Promise<void> {
  let posts: WhatsNewPost[];
  try {
    posts = await readPosts();
  } catch (err) {
    console.error("[whats-new] image sweep skipped (posts unreadable):", err);
    return;
  }
  const referenced = new Set(posts.flatMap(imageFilenamesOf));
  try {
    for await (const entry of Deno.readDir(IMAGES_DIR)) {
      if (!entry.isFile || referenced.has(entry.name)) continue;
      const path = `${IMAGES_DIR}/${entry.name}`;
      try {
        const stat = await Deno.stat(path);
        const mtime = stat.mtime?.getTime() ?? Date.now();
        if (Date.now() - mtime > ORPHAN_MIN_AGE_MS) {
          await Deno.remove(path);
          console.log(`[whats-new] removed orphan image ${entry.name}`);
        }
      } catch {
        // stat/remove race — ignore
      }
    }
  } catch {
    // images dir doesn't exist yet — nothing to sweep
  }
}

export function startWhatsNewImageSweep(): void {
  const run = () => sweepOrphanImages().catch((err) => console.error("[whats-new] image sweep failed:", err));
  run();
  setInterval(run, SWEEP_INTERVAL_MS);
}

// Public: published posts for platform servers to fetch (scheduled posts
// appear once their publishAt has passed)
router.get("/posts", async (c) => {
  const posts = await readPosts();
  const now = Date.now();
  const published = posts
    .filter((p) => p.published && (!p.publishAt || Date.parse(p.publishAt) <= now))
    .sort((a, b) => compareVersions(b.version, a.version));
  return c.json({ posts: published });
});

// Public: serve uploaded images (UUID filenames are immutable)
router.get("/images/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (!/^[A-Za-z0-9-]+\.[a-z]+$/.test(filename)) return c.text("Bad filename", 400);
  const contentType = IMAGE_CONTENT_TYPES[filename.split(".").pop()!];
  if (!contentType) return c.text("Unsupported file type", 400);
  try {
    const bytes = await Deno.readFile(`${IMAGES_DIR}/${filename}`);
    return c.body(bytes, 200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  } catch {
    return c.text("Not found", 404);
  }
});

// Admin: all posts including drafts
router.get("/admin/posts", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  const posts = await readPosts();
  posts.sort((a, b) => compareVersions(b.version, a.version));
  return c.json({ posts });
});

// Admin: create post
router.post("/admin/posts", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const result = validatePostInput(await c.req.json());
  if ("error" in result) return c.json({ success: false, error: result.error });

  const now = new Date().toISOString();
  const post: WhatsNewPost = { id: crypto.randomUUID(), ...result.post, createdAt: now, updatedAt: now };
  await withPostsLock(async () => {
    const posts = await readPosts();
    posts.push(post);
    await writePosts(posts);
  });
  return c.json({ success: true, post });
});

// Admin: update post (full replace); images dropped by the update are removed
router.put("/admin/posts/:id", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const id = c.req.param("id");
  const result = validatePostInput(await c.req.json());
  if ("error" in result) return c.json({ success: false, error: result.error });

  const outcome = await withPostsLock(async () => {
    const posts = await readPosts();
    const idx = posts.findIndex((p) => p.id === id);
    if (idx === -1) return { error: "Post not found" as const };
    const previous = posts[idx];
    const post: WhatsNewPost = {
      ...previous,
      ...result.post,
      // full replace: a cleared publishAt must not linger from the old post
      publishAt: result.post.publishAt,
      updatedAt: new Date().toISOString(),
    };
    if (post.publishAt === undefined) delete post.publishAt;
    posts[idx] = post;
    await writePosts(posts);
    const kept = new Set(imageFilenamesOf(post));
    const dropped = imageFilenamesOf(previous).filter((f) => !kept.has(f));
    return { post, dropped };
  });
  if ("error" in outcome) return c.json({ success: false, error: outcome.error });
  await deleteImageFiles(outcome.dropped);
  return c.json({ success: true, post: outcome.post });
});

// Admin: delete post + its uploaded images
router.delete("/admin/posts/:id", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const id = c.req.param("id");
  const outcome = await withPostsLock(async () => {
    const posts = await readPosts();
    const idx = posts.findIndex((p) => p.id === id);
    if (idx === -1) return { error: "Post not found" as const };
    const [removed] = posts.splice(idx, 1);
    await writePosts(posts);
    return { removed };
  });
  if ("error" in outcome) return c.json({ success: false, error: outcome.error });
  await deleteImageFiles(imageFilenamesOf(outcome.removed));
  return c.json({ success: true });
});

// Admin: multipart image upload
router.post("/admin/upload", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ success: false, error: "No file provided" });
  const ext = ALLOWED_UPLOAD_TYPES.get(file.type);
  if (!ext) return c.json({ success: false, error: `Unsupported file type: ${file.type || "unknown"}` });
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ success: false, error: "File too large (max 10MB)" });

  const filename = `${crypto.randomUUID()}.${ext}`;
  await Deno.mkdir(IMAGES_DIR, { recursive: true });
  await Deno.writeFile(`${IMAGES_DIR}/${filename}`, new Uint8Array(await file.arrayBuffer()));
  return c.json({ success: true, imageUrl: `${PUBLIC_API_BASE}/api/whats-new/images/${filename}` });
});

export default router;
