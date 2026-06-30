/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { getAuth } from "@hono/clerk-auth";
import { getUserEmail, requireAdmin, requireSuperUser } from "../lib/auth.ts";

const router = new Hono();

const CONFIG_DIR = "/mnt/fastr-config";
const ACCESS_LOG_FILE = `${CONFIG_DIR}/admin-access-log.jsonl`;
// Cap the payload returned to the frontend so the log file growing unbounded
// never blows up a single response.
const MAX_RETURNED = 5000;

interface AccessLogEntry {
    email: string;
    userId: string;
    timestamp: string; // ISO 8601
    userAgent: string;
}

// Record one visit. Any admin who loads the site may write. The email is resolved
// server-side from the verified Clerk session (not the request body), so it cannot
// be spoofed.
router.post("/", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const auth = getAuth(c);
    const userId = auth?.sessionClaims?.sub || auth?.userId;
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const email = (await getUserEmail(userId)) ?? "unknown";
    const entry: AccessLogEntry = {
        email,
        userId,
        timestamp: new Date().toISOString(),
        userAgent: c.req.header("User-Agent") ?? "",
    };

    try {
        await Deno.mkdir(CONFIG_DIR, { recursive: true });
        await Deno.writeTextFile(ACCESS_LOG_FILE, JSON.stringify(entry) + "\n", { append: true });
    } catch (error) {
        console.error("Failed to write access log:", error);
        return c.json({ error: "Failed to record access" }, 500);
    }

    return c.json({ success: true });
});

// Read the log — restricted to the super user (nick@usefuldata.com.au).
router.get("/", async (c) => {
    const authError = await requireSuperUser(c);
    if (authError) return authError;

    let text: string;
    try {
        text = await Deno.readTextFile(ACCESS_LOG_FILE);
    } catch {
        return c.json({ entries: [], total: 0 });
    }

    const entries: AccessLogEntry[] = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            entries.push(JSON.parse(trimmed));
        } catch {
            // skip a malformed line rather than failing the whole request
        }
    }

    // newest first
    entries.reverse();
    return c.json({ entries: entries.slice(0, MAX_RETURNED), total: entries.length });
});

export default router;
