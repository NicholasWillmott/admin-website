/// <reference lib="deno.ns" />
import { Hono } from "hono";

const router = new Hono();

const CHANGELOG_FILE = "/mnt/fastr-config/CHANGELOG.md";
const CHANGELOG_ADMIN_FILE = "/mnt/fastr-config/CHANGELOG-ADMIN.md";

export async function readChangelog(): Promise<string> {
    try {
        return await Deno.readTextFile(CHANGELOG_FILE);
    } catch {
        return "";
    }
}

export async function readChangelogAdmin(): Promise<string> {
    try {
        return await Deno.readTextFile(CHANGELOG_ADMIN_FILE);
    } catch {
        return "";
    }
}

async function replaceEntry(file: string, version: string, newEntry: string): Promise<boolean> {
    const existing = file === CHANGELOG_FILE ? await readChangelog() : await readChangelogAdmin();
    if (!existing) return false;

    const lines = existing.split("\n");
    const startLine = lines.findIndex(l => l.startsWith(`## [${version}]`));
    if (startLine === -1) return false;

    const endLine = lines.findIndex((l, i) => i > startLine && l.startsWith("## ["));
    const head = lines.slice(0, startLine).join("\n");
    const tail = endLine === -1 ? "" : lines.slice(endLine).join("\n");
    const updated = tail ? `${head}${newEntry}\n\n${tail}` : `${head}${newEntry}\n`;

    await Deno.writeTextFile(file, updated);
    return true;
}

async function prependEntry(file: string, entry: string, title: string): Promise<void> {
    const existing = file === CHANGELOG_FILE ? await readChangelog() : await readChangelogAdmin();
    let updated: string;

    if (existing) {
        const lines = existing.split("\n");
        const firstEntryLine = lines.findIndex(l => l.startsWith("## ["));
        if (firstEntryLine !== -1) {
            const head = lines.slice(0, firstEntryLine).join("\n");
            const tail = lines.slice(firstEntryLine).join("\n");
            updated = `${head}\n${entry}\n\n${tail}`;
        } else {
            updated = `${existing}\n\n${entry}\n`;
        }
    } else {
        updated = `# ${title}\n\nAll notable changes are documented here.\n\n${entry}\n`;
    }

    await Deno.mkdir("/mnt/fastr-config", { recursive: true });
    await Deno.writeTextFile(file, updated);
}

function requireApiKey(c: any): boolean {
    const apiKey = Deno.env.get("STATUS_API_KEY");
    if (!apiKey) return false;
    return c.req.header("Authorization") === `Bearer ${apiKey}`;
}

router.get("/", async (c) => {
    const content = await readChangelog();
    if (!content) return c.text("", 404);
    return c.text(content);
});

router.post("/entry", async (c) => {
    if (!requireApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json() as { version: string; entry: string };
    if (!body.entry || !body.version) return c.json({ error: "Missing version or entry" }, 400);

    await prependEntry(CHANGELOG_FILE, body.entry, "Changelog");
    return c.json({ success: true });
});

router.put("/entry", async (c) => {
    if (!requireApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json() as { version: string; entry: string };
    if (!body.entry || !body.version) return c.json({ error: "Missing version or entry" }, 400);

    const replaced = await replaceEntry(CHANGELOG_FILE, body.version, body.entry);
    if (!replaced) return c.json({ error: "Version not found" }, 404);
    return c.json({ success: true });
});

router.get("/superadmin", async (c) => {
    if (!requireApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

    const content = await readChangelogAdmin();
    if (!content) return c.text("", 404);
    return c.text(content);
});

router.post("/superadmin/entry", async (c) => {
    if (!requireApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json() as { version: string; entry: string };
    if (!body.entry || !body.version) return c.json({ error: "Missing version or entry" }, 400);

    await prependEntry(CHANGELOG_ADMIN_FILE, body.entry, "Changelog (Admin)");
    return c.json({ success: true });
});

router.put("/superadmin/entry", async (c) => {
    if (!requireApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json() as { version: string; entry: string };
    if (!body.entry || !body.version) return c.json({ error: "Missing version or entry" }, 400);

    const replaced = await replaceEntry(CHANGELOG_ADMIN_FILE, body.version, body.entry);
    if (!replaced) return c.json({ error: "Version not found" }, 404);
    return c.json({ success: true });
});

export default router;
