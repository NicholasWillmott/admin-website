/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import { H_USERS } from "../h_users.ts";

const router = new Hono();

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
