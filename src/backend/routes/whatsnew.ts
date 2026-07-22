/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";

const router = new Hono();

const WHATS_NEW_DIR = "/mnt/fastr-config/whats-new";
const POSTS_FILE = `${WHATS_NEW_DIR}/posts.json`;
const IMAGES_DIR = `${WHATS_NEW_DIR}/images`;
const PUBLIC_API_BASE = Deno.env.get("PUBLIC_API_BASE") ?? "https://status-api.fastr-analytics.org";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
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

const IMAGE_POSITIONS = ["top", "bottom", "left", "right"] as const;
type WhatsNewImagePosition = (typeof IMAGE_POSITIONS)[number];

// English required; fr/pt fall back to English in the platform when absent
interface WhatsNewText {
  en: string;
  fr?: string;
  pt?: string;
}

interface WhatsNewPage {
  title?: WhatsNewText;
  body: WhatsNewText;
  imageUrl?: string;
  imagePosition?: WhatsNewImagePosition;
  imageWidth?: number; // % of content width, 10-100
}

interface WhatsNewPost {
  id: string;
  version: string;
  title: WhatsNewText;
  pages: WhatsNewPage[];
  adminsOnly: boolean;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

// Posts stored before the multi-language change have plain-string text fields
function normalizeText(v: unknown): WhatsNewText {
  return typeof v === "string" ? { en: v } : (v as WhatsNewText);
}

function normalizePost(p: WhatsNewPost): WhatsNewPost {
  return {
    ...p,
    title: normalizeText(p.title),
    pages: p.pages.map((page) => ({
      ...page,
      ...(page.title !== undefined ? { title: normalizeText(page.title) } : {}),
      body: normalizeText(page.body),
    })),
  };
}

async function readPosts(): Promise<WhatsNewPost[]> {
  try {
    const text = await Deno.readTextFile(POSTS_FILE);
    const posts: WhatsNewPost[] = JSON.parse(text).posts ?? [];
    return posts.map(normalizePost);
  } catch {
    return [];
  }
}

async function writePosts(posts: WhatsNewPost[]): Promise<void> {
  await Deno.mkdir(WHATS_NEW_DIR, { recursive: true });
  await Deno.writeTextFile(POSTS_FILE, JSON.stringify({ posts }, null, 2));
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

// Validates a {en, fr?, pt?} text field. English is required when
// `required`, or when any other language is present (it is the fallback).
// Returns the cleaned text, null when the field is entirely empty, or an
// error. Bodies are not trimmed (leading whitespace is meaningful markdown).
function cleanText(
  v: unknown,
  label: string,
  opts: { required: boolean; trim: boolean },
): { text: WhatsNewText | null } | { error: string } {
  const raw = typeof v === "string" ? { en: v } : v;
  if (raw === undefined || raw === null) {
    return opts.required ? { error: `${label} is required` } : { text: null };
  }
  const t = raw as Partial<WhatsNewText>;
  if (typeof t !== "object") return { error: `Invalid ${label}` };
  for (const lang of ["en", "fr", "pt"] as const) {
    if (t[lang] !== undefined && typeof t[lang] !== "string") return { error: `Invalid ${label}` };
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
  const titleResult = cleanText(b.title, "Title", { required: true, trim: true });
  if ("error" in titleResult) return titleResult;
  const title = titleResult.text!;
  const version = typeof b.version === "string" ? b.version.trim() : "";
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { error: "Version must be in the form 1.62.0" };
  if (!Array.isArray(b.pages) || b.pages.length === 0) return { error: "At least one page is required" };
  const pages: WhatsNewPage[] = [];
  for (const raw of b.pages) {
    const page = raw as Partial<WhatsNewPage> | null;
    if (!page || typeof page !== "object") return { error: "Invalid page" };
    const bodyResult = cleanText(page.body, "Page body", { required: true, trim: false });
    if ("error" in bodyResult) return bodyResult;
    const titleRes = cleanText(page.title, "Page heading", { required: false, trim: true });
    if ("error" in titleRes) return titleRes;
    if (page.imagePosition !== undefined && !IMAGE_POSITIONS.includes(page.imagePosition)) {
      return { error: "Invalid image position" };
    }
    if (page.imageUrl !== undefined && typeof page.imageUrl !== "string") return { error: "Invalid image URL" };
    if (
      page.imageWidth !== undefined &&
      (typeof page.imageWidth !== "number" || !Number.isFinite(page.imageWidth) ||
        page.imageWidth < 10 || page.imageWidth > 100)
    ) {
      return { error: "Image width must be between 10 and 100" };
    }
    pages.push({
      ...(titleRes.text ? { title: titleRes.text } : {}),
      body: bodyResult.text!,
      ...(page.imageUrl ? { imageUrl: page.imageUrl } : {}),
      ...(page.imageUrl && page.imagePosition ? { imagePosition: page.imagePosition } : {}),
      ...(page.imageUrl && page.imageWidth !== undefined ? { imageWidth: Math.round(page.imageWidth) } : {}),
    });
  }
  return { post: { title, version, pages, adminsOnly: b.adminsOnly === true, published: b.published === true } };
}

// Best-effort cleanup of uploaded images referenced by a deleted post
async function deleteReferencedImages(post: WhatsNewPost): Promise<void> {
  for (const page of post.pages) {
    const filename = page.imageUrl?.split("/api/whats-new/images/")[1];
    if (!filename || !/^[A-Za-z0-9-]+\.[a-z]+$/.test(filename)) continue;
    try {
      await Deno.remove(`${IMAGES_DIR}/${filename}`);
    } catch {
      // already gone or shared — ignore
    }
  }
}

// Public: published posts for platform servers to fetch
router.get("/posts", async (c) => {
  const posts = await readPosts();
  const published = posts
    .filter((p) => p.published)
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
  const posts = await readPosts();
  posts.push(post);
  await writePosts(posts);
  return c.json({ success: true, post });
});

// Admin: update post (full replace)
router.put("/admin/posts/:id", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const id = c.req.param("id");
  const result = validatePostInput(await c.req.json());
  if ("error" in result) return c.json({ success: false, error: result.error });

  const posts = await readPosts();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) return c.json({ success: false, error: "Post not found" });

  const post: WhatsNewPost = {
    ...posts[idx],
    ...result.post,
    updatedAt: new Date().toISOString(),
  };
  posts[idx] = post;
  await writePosts(posts);
  return c.json({ success: true, post });
});

// Admin: delete post + its uploaded images
router.delete("/admin/posts/:id", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const id = c.req.param("id");
  const posts = await readPosts();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) return c.json({ success: false, error: "Post not found" });

  const [removed] = posts.splice(idx, 1);
  await writePosts(posts);
  await deleteReferencedImages(removed);
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
