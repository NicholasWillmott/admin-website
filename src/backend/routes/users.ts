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

// Seed the stored users-to-check list (merges, does not overwrite).
router.post("/language-report/seed", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ emails: string[] }>();
    if (!Array.isArray(body.emails)) return c.json({ error: "emails must be an array" }, 400);

    const state = await readReportState();
    const existing = new Set(state.emails.map((e: string) => e.toLowerCase()));
    const added: string[] = [];
    for (const e of body.emails) {
        const lower = e.trim().toLowerCase();
        if (lower && !existing.has(lower)) { added.push(lower); existing.add(lower); }
    }
    const updated: LanguageReportState = { emails: [...state.emails, ...added], lastRunAt: state.lastRunAt };
    await writeReportState(updated);
    return c.json({ added: added.length, total: updated.emails.length });
});

// Generate technical support email list CSV.
// Uses the stored users-to-check list as the base, and adds only Clerk users
// who signed up (created_at) since the last run. Never pulls the full user list.
router.post("/language-report", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const state = await readReportState();
    const runAt = Date.now();

    // Only fetch new signups if we have a previous run timestamp to anchor against
    const added: string[] = [];
    if (state.lastRunAt) {
        const existingSet = new Set(state.emails.map((e: string) => e.toLowerCase()));
        const clerkLimit = 500;
        let clerkOffset = 0;
        // Fetch newest users first; stop once we reach users created before lastRunAt
        outer: while (true) {
            const url = new URL("https://api.clerk.com/v1/users");
            url.searchParams.set("limit", String(clerkLimit));
            url.searchParams.set("offset", String(clerkOffset));
            url.searchParams.set("order_by", "-created_at");
            const resp = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${clerkSecretKey}` },
            });
            if (!resp.ok) return c.json({ error: "Failed to fetch Clerk users" }, 502);
            const page = await resp.json();
            for (const u of page) {
                if (u.created_at < state.lastRunAt!) break outer;
                const primary = (u.email_addresses ?? []).find((e: { id: string }) => e.id === u.primary_email_address_id);
                const email = primary?.email_address?.toLowerCase();
                if (email && !existingSet.has(email)) {
                    added.push(email);
                    existingSet.add(email);
                }
            }
            if (page.length < clerkLimit) break;
            clerkOffset += clerkLimit;
        }
    }

    const allEmails = [...state.emails, ...added];

    // Fetch all servers
    const serversResp = await fetch("https://central.fastr-analytics.org/servers.json");
    type ServerLangFlags = { id: string; french?: boolean; portuguese?: boolean };
    const servers: ServerLangFlags[] = await serversResp.json();
    const serverLanguage = (s: ServerLangFlags): Language =>
        s.portuguese ? "portuguese" : s.french ? "french" : "english";

    // Fetch server users in parallel (up to 8 concurrent)
    type Language = "french" | "portuguese" | "english";
    const serverInfo = new Map<string, { language: Language; users: Set<string> }>();
    const CONCURRENCY = 8;
    const queue = [...servers];
    async function fetchServer(s: ServerLangFlags) {
        try {
            const r = await fetch(`https://${s.id}.fastr-analytics.org/health_check`, { signal: AbortSignal.timeout(15000) });
            if (!r.ok) return;
            const data = await r.json();
            const users = new Set<string>((data.serverUsers ?? []).map((u: string) => u.toLowerCase()));
            serverInfo.set(s.id, { language: serverLanguage(s), users });
        } catch { /* skip offline servers */ }
    }
    const workers: Promise<void>[] = [];
    let qi = 0;
    async function worker() {
        while (qi < queue.length) { const s = queue[qi++]; await fetchServer(s); }
    }
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) workers.push(worker());
    await Promise.all(workers);

    // Categorise. Language is mutually exclusive per server, so a user lands in a
    // single-language bucket, "multiple" if they span more than one language, or
    // "neither" if they're on no server.
    type Cat = "french-only" | "portuguese-only" | "english-only" | "multiple" | "neither";
    const cols: Record<Cat, string[]> = { "french-only": [], "portuguese-only": [], "english-only": [], multiple: [], neither: [] };
    const detail: string[] = ["email,category,french_servers,portuguese_servers,english_servers,not_on_any_server"];

    const serversForLanguage = (email: string, language: Language) =>
        [...serverInfo.entries()].filter(([, v]) => v.language === language && v.users.has(email)).map(([id]) => id).sort();

    for (const email of allEmails) {
        const fr = serversForLanguage(email, "french");
        const pt = serversForLanguage(email, "portuguese");
        const en = serversForLanguage(email, "english");
        const present = [fr, pt, en].filter((s) => s.length > 0).length;
        let cat: Cat;
        if (present > 1) cat = "multiple";
        else if (fr.length) cat = "french-only";
        else if (pt.length) cat = "portuguese-only";
        else if (en.length) cat = "english-only";
        else cat = "neither";
        cols[cat].push(email);
        detail.push(`${email},${cat},"${fr.join(",")}","${pt.join(",")}","${en.join(",")}",${cat === "neither" ? "yes" : ""}`);
    }

    // Build column CSV (one column per category)
    const maxRows = Math.max(...Object.values(cols).map((c) => c.length));
    const fourCol = ["french_servers,portuguese_servers,english_servers,multiple,neither"];
    for (let i = 0; i < maxRows; i++) {
        fourCol.push([
            cols["french-only"][i] ?? "",
            cols["portuguese-only"][i] ?? "",
            cols["english-only"][i] ?? "",
            cols.multiple[i] ?? "",
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
            portuguese: cols["portuguese-only"].length,
            english: cols["english-only"].length,
            multiple: cols.multiple.length,
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
