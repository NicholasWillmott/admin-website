/// <reference lib="deno.ns" />
import { Hono } from "hono";
import {
    invalidateAdminStatus,
    requireAdmin,
    requireSuperUser,
    SUPER_USER_EMAIL,
} from "../lib/auth.ts";

// Manages who can access this admin website. "Access" is the boolean
// public_metadata.isAdmin on a Clerk user (see lib/auth.ts), so every endpoint
// here is a thin wrapper around the Clerk API. Listing is open to all admins;
// granting/revoking/inviting is restricted to the super user.
const router = new Hono();

const CLERK_API = "https://api.clerk.com/v1";
const ADMIN_SITE_URL = "https://status.fastr-analytics.org";

function clerkHeaders(): HeadersInit {
    return {
        Authorization: `Bearer ${Deno.env.get("CLERK_SECRET_KEY")}`,
        "Content-Type": "application/json",
    };
}

// Clerk errors look like { errors: [{ message, long_message }] }
async function clerkErrorMessage(response: Response): Promise<string> {
    try {
        const body = await response.json();
        return body?.errors?.[0]?.long_message || body?.errors?.[0]?.message ||
            `Clerk request failed (${response.status})`;
    } catch {
        return `Clerk request failed (${response.status})`;
    }
}

// Clerk ids (user_..., inv_...) — validated before being interpolated into URLs
const isClerkId = (id: unknown): id is string =>
    typeof id === "string" && /^[A-Za-z0-9_]+$/.test(id);

// List everyone with admin access, plus pending invitations
router.get("/", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const limit = 500;
    const admins = [];
    let offset = 0;

    while (true) {
        const response = await fetch(
            `${CLERK_API}/users?limit=${limit}&offset=${offset}`,
            { headers: clerkHeaders() },
        );
        if (!response.ok) {
            return c.json({ error: "Failed to fetch users" }, 502);
        }
        const page = await response.json();
        admins.push(
            ...page.filter((u: { public_metadata?: { isAdmin?: unknown } }) =>
                u.public_metadata?.isAdmin === true
            ),
        );
        if (page.length < limit) break;
        offset += limit;
    }

    const inviteResponse = await fetch(
        `${CLERK_API}/invitations?status=pending&limit=100`,
        { headers: clerkHeaders() },
    );
    let invitations = [];
    if (inviteResponse.ok) {
        const raw = await inviteResponse.json();
        invitations = Array.isArray(raw) ? raw : raw?.data ?? [];
    }

    return c.json({ admins, invitations });
});

// Grant admin access to an existing Clerk user
router.post("/grant", async (c) => {
    const authError = await requireSuperUser(c);
    if (authError) return authError;

    const { userId } = await c.req.json<{ userId?: string }>();
    if (!isClerkId(userId)) {
        return c.json({ success: false, error: "userId is required" }, 400);
    }

    // PATCH does a shallow merge, so other public_metadata keys are preserved
    const response = await fetch(`${CLERK_API}/users/${userId}/metadata`, {
        method: "PATCH",
        headers: clerkHeaders(),
        body: JSON.stringify({ public_metadata: { isAdmin: true } }),
    });
    if (!response.ok) {
        return c.json({ success: false, error: await clerkErrorMessage(response) }, 502);
    }

    invalidateAdminStatus(userId);
    return c.json({ success: true });
});

// Revoke a user's admin access
router.post("/revoke", async (c) => {
    const authError = await requireSuperUser(c);
    if (authError) return authError;

    const { userId } = await c.req.json<{ userId?: string }>();
    if (!isClerkId(userId)) {
        return c.json({ success: false, error: "userId is required" }, 400);
    }

    // Never revoke the super user — prevents locking yourself out
    const userResponse = await fetch(`${CLERK_API}/users/${userId}`, {
        headers: clerkHeaders(),
    });
    if (!userResponse.ok) {
        return c.json({ success: false, error: await clerkErrorMessage(userResponse) }, 502);
    }
    const user = await userResponse.json();
    const primary = (user.email_addresses ?? []).find(
        (e: { id: string }) => e.id === user.primary_email_address_id,
    );
    if (primary?.email_address?.toLowerCase() === SUPER_USER_EMAIL) {
        return c.json(
            { success: false, error: "The super user's access cannot be revoked" },
            400,
        );
    }

    const response = await fetch(`${CLERK_API}/users/${userId}/metadata`, {
        method: "PATCH",
        headers: clerkHeaders(),
        body: JSON.stringify({ public_metadata: { isAdmin: false } }),
    });
    if (!response.ok) {
        return c.json({ success: false, error: await clerkErrorMessage(response) }, 502);
    }

    invalidateAdminStatus(userId);
    return c.json({ success: true });
});

// Invite a new person by email. The invitation carries isAdmin in its
// public_metadata, which Clerk copies onto the user when they sign up — so
// they have access the moment they accept. Fails if the email already belongs
// to an existing user (grant instead).
router.post("/invite", async (c) => {
    const authError = await requireSuperUser(c);
    if (authError) return authError;

    const { email } = await c.req.json<{ email?: string }>();
    const trimmed = email?.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return c.json({ success: false, error: "A valid email address is required" }, 400);
    }

    const response = await fetch(`${CLERK_API}/invitations`, {
        method: "POST",
        headers: clerkHeaders(),
        body: JSON.stringify({
            email_address: trimmed,
            public_metadata: { isAdmin: true },
            redirect_url: ADMIN_SITE_URL,
            notify: true,
        }),
    });
    if (!response.ok) {
        return c.json({ success: false, error: await clerkErrorMessage(response) }, 502);
    }

    return c.json({ success: true });
});

// Revoke a pending invitation
router.post("/invitations/:invitationId/revoke", async (c) => {
    const authError = await requireSuperUser(c);
    if (authError) return authError;

    const invitationId = c.req.param("invitationId");
    if (!isClerkId(invitationId)) {
        return c.json({ success: false, error: "Invalid invitation id" }, 400);
    }

    const response = await fetch(
        `${CLERK_API}/invitations/${invitationId}/revoke`,
        { method: "POST", headers: clerkHeaders() },
    );
    if (!response.ok) {
        return c.json({ success: false, error: await clerkErrorMessage(response) }, 502);
    }

    return c.json({ success: true });
});

export default router;
