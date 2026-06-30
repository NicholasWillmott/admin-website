/// <reference lib="deno.ns" />
import { getAuth } from "@hono/clerk-auth";
import type { Context } from "hono";

export async function requireAdminOrInternal(c: Context) {
  const internalKey = Deno.env.get("STATUS_API_KEY");
  if (internalKey && c.req.header("X-Internal-Key") === internalKey) {
    return null;
  }
  return requireAdmin(c);
}

// Cache Clerk admin lookups so bursts of requests (e.g. per-server fan-outs from the
// frontend) don't each hit the Clerk API. The in-flight promise is cached, not just the
// result, so concurrent requests on a cold cache share a single Clerk call.
// Trade-off: revoking a user's admin flag takes up to ADMIN_CACHE_TTL_MS to apply here.
const ADMIN_CACHE_TTL_MS = 60_000;
const adminStatusCache = new Map<string, { promise: Promise<boolean>; expires: number }>();

function getIsAdmin(userId: string): Promise<boolean> {
  const cached = adminStatusCache.get(userId);
  if (cached && cached.expires > Date.now()) {
    return cached.promise;
  }

  const promise = fetchIsAdminFromClerk(userId);
  adminStatusCache.set(userId, { promise, expires: Date.now() + ADMIN_CACHE_TTL_MS });

  // Don't cache failures — drop the entry so the next request retries
  promise.catch(() => {
    if (adminStatusCache.get(userId)?.promise === promise) {
      adminStatusCache.delete(userId);
    }
  });

  return promise;
}

async function fetchIsAdminFromClerk(userId: string): Promise<boolean> {
  const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
  const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: {
      'Authorization': `Bearer ${clerkSecretKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.error("Failed to fetch user from Clerk:", await response.text());
    throw new Error(`Clerk user lookup failed with status ${response.status}`);
  }

  const user = await response.json();
  return user.public_metadata?.isAdmin === true;
}

// The single user permitted to read the admin access log.
export const SUPER_USER_EMAIL = "nick@usefuldata.com.au";

// Cache Clerk email lookups, same TTL/in-flight strategy as the admin cache above.
const emailCache = new Map<string, { promise: Promise<string | null>; expires: number }>();

export function getUserEmail(userId: string): Promise<string | null> {
  const cached = emailCache.get(userId);
  if (cached && cached.expires > Date.now()) {
    return cached.promise;
  }

  const promise = fetchEmailFromClerk(userId);
  emailCache.set(userId, { promise, expires: Date.now() + ADMIN_CACHE_TTL_MS });

  promise.catch(() => {
    if (emailCache.get(userId)?.promise === promise) {
      emailCache.delete(userId);
    }
  });

  return promise;
}

async function fetchEmailFromClerk(userId: string): Promise<string | null> {
  const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
  const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: {
      'Authorization': `Bearer ${clerkSecretKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.error("Failed to fetch user from Clerk:", await response.text());
    throw new Error(`Clerk user lookup failed with status ${response.status}`);
  }

  const user = await response.json();
  const primary = (user.email_addresses ?? []).find(
    (e: { id: string }) => e.id === user.primary_email_address_id,
  );
  return primary?.email_address?.toLowerCase() ?? null;
}

export async function requireAdmin(c: Context) {
  const auth = getAuth(c);

  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = auth.sessionClaims?.sub || auth.userId;

  try {
    const isAdmin = await getIsAdmin(userId);

    if (!isAdmin) {
      return c.json({ error: "Forbidden - Admin access required" }, 403);
    }

    return null;
  } catch (error) {
    console.error("Error checking admin status:", error);
    return c.json({ error: "Failed to verify user permissions" }, 500);
  }
}

// Restricts a route to SUPER_USER_EMAIL. Returns null on success, or an error
// Response (mirrors requireAdmin's contract so callers can `if (err) return err`).
export async function requireSuperUser(c: Context) {
  const auth = getAuth(c);

  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = auth.sessionClaims?.sub || auth.userId;

  try {
    const email = await getUserEmail(userId);

    if (email !== SUPER_USER_EMAIL) {
      return c.json({ error: "Forbidden - Restricted access" }, 403);
    }

    return null;
  } catch (error) {
    console.error("Error checking super user status:", error);
    return c.json({ error: "Failed to verify user permissions" }, 500);
  }
}

