/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { fetchClerkJson, okJson, runTool, ToolFailure } from "./helpers.ts";

// Users & admins tools — Clerk Backend API reads. Unlike the /api/users route
// (which fetches EVERY user for the frontend's client-side views), list_users
// passes pagination and search straight through to Clerk so the model never
// dumps the whole user store into context.

interface ClerkApiUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: { id: string; email_address: string }[];
  primary_email_address_id: string | null;
  public_metadata?: { isAdmin?: unknown };
  created_at: number;
  last_sign_in_at: number | null;
  last_active_at: number | null;
}

// Clerk ids (user_..., inv_...) — validated before URL interpolation, same
// guard as routes/admins.ts
const isClerkId = (id: string): boolean => /^[A-Za-z0-9_]+$/.test(id);

const ms = (v: number | null): string | null =>
  v === null ? null : new Date(v).toISOString();

function projectUser(u: ClerkApiUser) {
  const primary = u.email_addresses.find((e) => e.id === u.primary_email_address_id);
  return {
    id: u.id,
    email: primary?.email_address ?? null,
    firstName: u.first_name,
    lastName: u.last_name,
    isAdmin: u.public_metadata?.isAdmin === true,
    createdAt: ms(u.created_at),
    lastSignInAt: ms(u.last_sign_in_at),
    lastActiveAt: ms(u.last_active_at),
  };
}

export function registerUserTools(server: McpServer): void {
  server.registerTool("list_users", {
    title: "List platform users",
    description:
      "Clerk users of the FASTR platform, paginated. query searches name/email. Returns id, email, name, isAdmin (admin-website access), created/last-sign-in/last-active timestamps.",
    inputSchema: z.object({
      query: z.string().optional().describe("Search by name or email"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    annotations: { readOnlyHint: true },
  }, ({ query, limit, offset }) =>
    runTool(async () => {
      const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (query) qs.set("query", query);
      const page = (await fetchClerkJson(`/users?${qs}`)) as ClerkApiUser[];
      return okJson({
        users: page.map(projectUser),
        offset,
        note: page.length === limit ? "More available — raise offset." : undefined,
      });
    }));

  server.registerTool("get_user_sessions", {
    title: "User sign-in sessions",
    description:
      "Sign-in sessions for one Clerk user (user_id from list_users), newest first, within the last since_days days.",
    inputSchema: z.object({
      user_id: z.string(),
      since_days: z.number().int().min(1).max(365).default(30),
    }),
    annotations: { readOnlyHint: true },
  }, ({ user_id, since_days }) =>
    runTool(async () => {
      if (!isClerkId(user_id)) {
        throw new ToolFailure(`Invalid user_id "${user_id}" — take ids from list_users.`);
      }
      const sinceMs = Date.now() - since_days * 24 * 60 * 60 * 1000;
      const limit = 100;
      const sessions: {
        id: string;
        status: string;
        created_at: number;
        last_active_at: number | null;
        expire_at: number | null;
      }[] = [];
      let offset = 0;
      // Clerk returns sessions newest first, so we can stop paginating as
      // soon as a page crosses the since boundary (same logic as the
      // /api/users/:userId/sessions route)
      while (true) {
        const page = (await fetchClerkJson(
          `/sessions?user_id=${user_id}&limit=${limit}&offset=${offset}`,
        )) as typeof sessions;
        const filtered = page.filter((s) => s.created_at >= sinceMs);
        sessions.push(...filtered);
        if (filtered.length < page.length || page.length < limit) break;
        offset += limit;
      }
      return okJson({
        sessions: sessions.map((s) => ({
          id: s.id,
          status: s.status,
          createdAt: ms(s.created_at),
          lastActiveAt: ms(s.last_active_at),
          expireAt: ms(s.expire_at),
        })),
      });
    }));

  server.registerTool("list_admins", {
    title: "List admin-website admins",
    description:
      "Everyone with access to this admin website (Clerk users with isAdmin), plus pending invitations.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, () =>
    runTool(async () => {
      const limit = 500;
      const admins: ReturnType<typeof projectUser>[] = [];
      let offset = 0;
      while (true) {
        const page = (await fetchClerkJson(`/users?limit=${limit}&offset=${offset}`)) as ClerkApiUser[];
        admins.push(
          ...page.filter((u) => u.public_metadata?.isAdmin === true).map(projectUser),
        );
        if (page.length < limit) break;
        offset += limit;
      }
      const rawInvites = await fetchClerkJson(`/invitations?status=pending&limit=100`);
      const invitations =
        (Array.isArray(rawInvites) ? rawInvites : (rawInvites as { data?: unknown[] })?.data ?? []) as {
          id: string;
          email_address: string;
          status: string;
          created_at: number;
        }[];
      return okJson({
        admins,
        pendingInvitations: invitations.map((i) => ({
          id: i.id,
          email: i.email_address,
          status: i.status,
          createdAt: ms(i.created_at),
        })),
      });
    }));
}
