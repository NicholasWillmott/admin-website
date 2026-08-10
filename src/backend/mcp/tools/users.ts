/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { readReportState } from "../../routes/users.ts";
import {
  fetchClerkJson,
  fetchFleetEndpoint,
  fetchServersJson,
  okJson,
  runTool,
  ToolFailure,
} from "./helpers.ts";

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

// Fetch every Clerk user, paginated (same loop as routes/admins.ts). Fine for
// this user base (~hundreds); tools that can pass filters to Clerk directly
// (list_users) should keep doing that instead.
async function fetchAllClerkUsers(): Promise<ClerkApiUser[]> {
  const limit = 500;
  const all: ClerkApiUser[] = [];
  let offset = 0;
  while (true) {
    const page = (await fetchClerkJson(`/users?limit=${limit}&offset=${offset}`)) as ClerkApiUser[];
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

// Monday of the week containing the timestamp, as YYYY-MM-DD (UTC)
function weekStart(msSinceEpoch: number): string {
  const d = new Date(msSinceEpoch);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

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

  server.registerTool("get_signups", {
    title: "Signups per week",
    description:
      "New platform registrations per week (Clerk), newest week first, with how many of each cohort activated (signed in again more than 24h after registering).",
    inputSchema: z.object({
      weeks: z.number().int().min(1).max(52).default(12),
    }),
    annotations: { readOnlyHint: true },
  }, ({ weeks }) =>
    runTool(async () => {
      const cutoffMs = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
      // Newest-first ordering lets pagination stop at the cutoff instead of
      // walking the whole user store (same trick as the language-report route)
      const limit = 500;
      const recent: ClerkApiUser[] = [];
      let offset = 0;
      paging: while (true) {
        const page = (await fetchClerkJson(
          `/users?limit=${limit}&offset=${offset}&order_by=-created_at`,
        )) as ClerkApiUser[];
        for (const u of page) {
          if (u.created_at < cutoffMs) break paging;
          recent.push(u);
        }
        if (page.length < limit) break;
        offset += limit;
      }
      const byWeek = new Map<string, { signups: number; activated: number }>();
      for (const u of recent) {
        const key = weekStart(u.created_at);
        const bucket = byWeek.get(key) ?? { signups: 0, activated: 0 };
        bucket.signups++;
        if (u.last_sign_in_at !== null && u.last_sign_in_at - u.created_at > 24 * 60 * 60 * 1000) {
          bucket.activated++;
        }
        byWeek.set(key, bucket);
      }
      const rows = [...byWeek.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([week_start, counts]) => ({ week_start, ...counts }));
      return okJson({
        weeks: rows,
        totalSignups: recent.length,
        totalActivated: rows.reduce((sum, r) => sum + r.activated, 0),
      });
    }));

  server.registerTool("get_inactive_users", {
    title: "Inactive users",
    description:
      "Platform users with no activity in the last N days (or ever), stalest first — the cleanup-round list. Activity = Clerk last_active_at / last_sign_in_at; falls back to registration date for never-signed-in accounts.",
    inputSchema: z.object({
      days: z.number().int().min(7).max(730).default(90),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    annotations: { readOnlyHint: true },
  }, ({ days, limit }) =>
    runTool(async () => {
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const users = await fetchAllClerkUsers();
      const lastActivity = (u: ClerkApiUser): number =>
        Math.max(u.last_active_at ?? 0, u.last_sign_in_at ?? 0) || u.created_at;
      const inactive = users
        .filter((u) => lastActivity(u) < cutoffMs)
        .sort((a, b) => lastActivity(a) - lastActivity(b));
      return okJson({
        totalInactive: inactive.length,
        totalUsers: users.length,
        users: inactive.slice(0, limit).map((u) => ({
          ...projectUser(u),
          lastActivityAt: ms(lastActivity(u)),
          neverSignedIn: u.last_sign_in_at === null,
        })),
        note: inactive.length > limit
          ? `Showing ${limit} of ${inactive.length} — raise limit.`
          : undefined,
      });
    }));

  server.registerTool("get_language_report", {
    title: "Support-list language report",
    description:
      "Categorize the stored support email list by the language of the instances each user belongs to (french-only / portuguese-only / english-only / multiple / neither). Read-only: reports on the stored list without refreshing it — new signups are added via the admin UI's generate button.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, () =>
    runTool(async () => {
      const state = await readReportState();
      if (state.emails.length === 0) {
        throw new ToolFailure(
          "The stored support list is empty (it lives on the droplet volume, so this is expected when running locally). Seed/generate it from the admin UI's Users view first.",
        );
      }
      const [servers, healthByServer] = await Promise.all([
        fetchServersJson(),
        fetchFleetEndpoint("health_check"),
      ]);
      // Same categorization as the POST /language-report route: language is
      // mutually exclusive per server, so a user lands in one language bucket,
      // "multiple" if they span languages, "neither" if on no server
      const serverLang = new Map(servers.map((s) => [
        s.id,
        s.portuguese ? "pt" : s.french ? "fr" : "en",
      ]));
      const usersByServer = new Map<string, Set<string>>();
      const unreachable: string[] = [];
      for (const s of servers) {
        const health = healthByServer[s.id] as { serverUsers?: string[] } | null;
        if (health === null) {
          unreachable.push(s.id);
          continue;
        }
        usersByServer.set(
          s.id,
          new Set((health.serverUsers ?? []).map((u) => u.toLowerCase())),
        );
      }
      const buckets: Record<string, string[]> = {
        "french-only": [],
        "portuguese-only": [],
        "english-only": [],
        multiple: [],
        neither: [],
      };
      for (const raw of state.emails) {
        const email = raw.toLowerCase();
        const langs = new Set<string>();
        for (const [id, userSet] of usersByServer) {
          if (userSet.has(email)) langs.add(serverLang.get(id) ?? "en");
        }
        const cat = langs.size > 1
          ? "multiple"
          : langs.has("fr")
          ? "french-only"
          : langs.has("pt")
          ? "portuguese-only"
          : langs.has("en")
          ? "english-only"
          : "neither";
        buckets[cat].push(email);
      }
      return okJson({
        trackedEmails: state.emails.length,
        listLastRefreshed: state.lastRunAt ? ms(state.lastRunAt) : null,
        counts: Object.fromEntries(
          Object.entries(buckets).map(([k, v]) => [k, v.length]),
        ),
        buckets,
        unreachable: unreachable.length
          ? { servers: unreachable, note: "Users only on these servers may be miscategorized as 'neither'." }
          : undefined,
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
      const admins = (await fetchAllClerkUsers())
        .filter((u) => u.public_metadata?.isAdmin === true)
        .map(projectUser);
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
