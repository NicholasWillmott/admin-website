/// <reference lib="deno.ns" />
import { getAuth } from "@hono/clerk-auth";

export async function requireAdmin(c: any) {
  const auth = getAuth(c);

  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = auth.sessionClaims?.sub || auth.userId;

  try {
    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${clerkSecretKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error("Failed to fetch user from Clerk:", await response.text());
      return c.json({ error: "Failed to verify user permissions" }, 500);
    }

    const user = await response.json();
    const isAdmin = user.public_metadata?.isAdmin === true;

    if (!isAdmin) {
      return c.json({ error: "Forbidden - Admin access required" }, 403);
    }

    return null;
  } catch (error) {
    console.error("Error checking admin status:", error);
    return c.json({ error: "Failed to verify user permissions" }, 500);
  }
}
