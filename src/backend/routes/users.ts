/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import { H_USERS } from "../h_users.ts";

const router = new Hono();

const LANGUAGE_REPORT_FILE = "/mnt/fastr-config/language-report.json";

interface LanguageReportState {
    emails: string[];
    lastRunAt: number | null;
}

async function readReportState(): Promise<LanguageReportState> {
    try {
        return JSON.parse(await Deno.readTextFile(LANGUAGE_REPORT_FILE));
    } catch {
        return { emails: [], lastRunAt: null };
    }
}

async function writeReportState(state: LanguageReportState): Promise<void> {
    await Deno.mkdir("/mnt/fastr-config", { recursive: true });
    await Deno.writeTextFile(LANGUAGE_REPORT_FILE, JSON.stringify(state));
}

// Generate language report CSV — adds any Clerk users who signed in since last run,
// then categorises all tracked emails by French/English server membership.
router.post("/language-report", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const state = await readReportState();
    const runAt = Date.now();

    // Fetch Clerk users who signed in since the last run and add new emails
    const clerkLimit = 500;
    let clerkOffset = 0;
    const newEmails = new Set<string>();
    while (true) {
        const url = new URL("https://api.clerk.com/v1/users");
        url.searchParams.set("limit", String(clerkLimit));
        url.searchParams.set("offset", String(clerkOffset));
        if (state.lastRunAt) {
            url.searchParams.set("last_active_at_since", String(state.lastRunAt));
        }
        const resp = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${clerkSecretKey}` },
        });
        if (!resp.ok) return c.json({ error: "Failed to fetch Clerk users" }, 502);
        const page = await resp.json();
        for (const u of page) {
            const primary = (u.email_addresses ?? []).find((e: { id: string }) => e.id === u.primary_email_address_id);
            if (primary?.email_address) newEmails.add(primary.email_address.toLowerCase());
        }
        if (page.length < clerkLimit) break;
        clerkOffset += clerkLimit;
    }

    // Merge new emails into the stored list (preserve order, dedupe)
    const existingSet = new Set(state.emails.map((e: string) => e.toLowerCase()));
    const added: string[] = [];
    for (const e of newEmails) {
        if (!existingSet.has(e)) { added.push(e); existingSet.add(e); }
    }
    const allEmails = [...state.emails, ...added];

    // Fetch all servers
    const serversResp = await fetch("https://central.fastr-analytics.org/servers.json");
    const servers: { id: string; french?: boolean }[] = await serversResp.json();

    // Fetch server users in parallel (up to 8 concurrent)
    const serverInfo = new Map<string, { isFrench: boolean; users: Set<string> }>();
    const CONCURRENCY = 8;
    const queue = [...servers];
    async function fetchServer(s: { id: string; french?: boolean }) {
        try {
            const r = await fetch(`https://${s.id}.fastr-analytics.org/health_check`, { signal: AbortSignal.timeout(15000) });
            if (!r.ok) return;
            const data = await r.json();
            const users = new Set<string>((data.serverUsers ?? []).map((u: string) => u.toLowerCase()));
            serverInfo.set(s.id, { isFrench: s.french ?? false, users });
        } catch { /* skip offline servers */ }
    }
    const workers: Promise<void>[] = [];
    let qi = 0;
    async function worker() {
        while (qi < queue.length) { const s = queue[qi++]; await fetchServer(s); }
    }
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) workers.push(worker());
    await Promise.all(workers);

    // Categorise
    type Cat = "french-only" | "english-only" | "both" | "neither";
    const cols: Record<Cat, string[]> = { "french-only": [], "english-only": [], both: [], neither: [] };
    const detail: string[] = ["email,category,french_servers,english_servers,not_on_any_server"];

    for (const email of allEmails) {
        const fr = [...serverInfo.entries()].filter(([, v]) => v.isFrench && v.users.has(email)).map(([id]) => id).sort();
        const en = [...serverInfo.entries()].filter(([, v]) => !v.isFrench && v.users.has(email)).map(([id]) => id).sort();
        let cat: Cat;
        if (fr.length && en.length) cat = "both";
        else if (fr.length) cat = "french-only";
        else if (en.length) cat = "english-only";
        else cat = "neither";
        cols[cat].push(email);
        detail.push(`${email},${cat},"${fr.join(",")}","${en.join(",")}",${cat === "neither" ? "yes" : ""}`);
    }

    // Build four-column CSV
    const maxRows = Math.max(cols["french-only"].length, cols["english-only"].length, cols.both.length, cols.neither.length);
    const fourCol = ["french_servers,english_servers,both,neither"];
    for (let i = 0; i < maxRows; i++) {
        fourCol.push([
            cols["french-only"][i] ?? "",
            cols["english-only"][i] ?? "",
            cols.both[i] ?? "",
            cols.neither[i] ?? "",
        ].join(","));
    }

    // Save updated state
    await writeReportState({ emails: allEmails, lastRunAt: runAt });

    // Return both CSVs as JSON so the frontend can download them
    return c.json({
        fourColumn: fourCol.join("\n"),
        detail: detail.join("\n"),
        stats: {
            french: cols["french-only"].length,
            english: cols["english-only"].length,
            both: cols.both.length,
            neither: cols.neither.length,
            newEmailsAdded: added.length,
            totalTracked: allEmails.length,
        },
    });
});

// Get all users
router.get("/", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const limit = 500;
    const allUsers = [];
    let offset = 0;

    while (true) {
        const response = await fetch(
            `https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`,
            { headers: { Authorization: `Bearer ${clerkSecretKey}` } }
        );

        if (!response.ok) {
            return c.json({ error: "Failed to fetch users" }, 502);
        }

        const page = await response.json();
        allUsers.push(...page);

        if (page.length < limit) break;
        offset += limit;
    }

    return c.json(allUsers);
});

// Get all sessions for a specific user (paginated)
router.get("/:userId/sessions", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const userId = c.req.param("userId");
    const since = c.req.query("since");
    const sinceMs = since ? Number(since) : null;
    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const limit = 100;

    try {
        const allSessions = [];
        let offset = 0;

        while (true) {
            const response = await fetch(
                `https://api.clerk.com/v1/sessions?user_id=${userId}&limit=${limit}&offset=${offset}`,
                { headers: { Authorization: `Bearer ${clerkSecretKey}` } }
            );

            if (!response.ok) {
                return c.json({ error: "Failed to fetch sessions" }, 502);
            }

            const page = await response.json();

            if (sinceMs) {
                const filtered = page.filter((s: { created_at: number }) => s.created_at >= sinceMs);
                allSessions.push(...filtered);
                if (filtered.length < page.length) break;
            } else {
                allSessions.push(...page);
            }

            if (page.length < limit) break;
            offset += limit;
        }

        return c.json(allSessions);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Get the list of internal H users (admin-only — keeps emails off the frontend bundle)
router.get("/h-users", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    return c.json([...H_USERS]);
});

export default router;
