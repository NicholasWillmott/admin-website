/// <reference lib="deno.ns" />
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { readReportState } from "../../routes/users.ts";
import {
  fetchClerkJson,
  fetchFleetEndpoint,
  fetchInstanceJson,
  fetchServersJson,
  mapConcurrent,
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

///////////////////////////////////////////////////////////////////////////////
// Language bucketing — shared by get_language_report and build_mailing_list
///////////////////////////////////////////////////////////////////////////////

// Bucket order is also the CSV column order, and both must match what
// POST /api/users/language-report emits (routes/users.ts) — the two produce
// files that get opened side by side.
const BUCKETS = [
  "french-only",
  "portuguese-only",
  "english-only",
  "multiple",
  "neither",
] as const;
type Bucket = typeof BUCKETS[number];

const BUCKET_CSV_HEADER =
  "french_servers,portuguese_servers,english_servers,multiple,neither";

interface FleetLanguages {
  servers: { id: string; isDemoOrTesting: boolean }[];
  /** instance id -> "fr" | "pt" | "en" */
  serverLang: Map<string, string>;
  /** instance id -> lowercased registered emails (health_check.serverUsers) */
  usersByServer: Map<string, Set<string>>;
  unreachable: string[];
}

// Registration (who has an account where) + the instance's language. Language
// is mutually exclusive per instance, pt winning over fr — the same precedence
// the deployer uses when setting INSTANCE_LANGUAGE.
async function loadFleetLanguages(): Promise<FleetLanguages> {
  const [registry, healthByServer] = await Promise.all([
    fetchServersJson(),
    fetchFleetEndpoint("health_check"),
  ]);
  const servers = registry.filter((s) => s.mode !== "central");
  const serverLang = new Map<string, string>();
  const usersByServer = new Map<string, Set<string>>();
  const unreachable: string[] = [];
  for (const s of servers) {
    serverLang.set(s.id, s.portuguese ? "pt" : s.french ? "fr" : "en");
    const health = healthByServer[s.id] as { serverUsers?: string[] } | null;
    if (health === null) {
      unreachable.push(s.id);
      continue;
    }
    usersByServer.set(
      s.id,
      new Set((health.serverUsers ?? []).map((u) => u.trim().toLowerCase())),
    );
  }
  return {
    servers: servers.map((s) => ({
      id: s.id,
      isDemoOrTesting: s.id.startsWith("testing") || s.id.startsWith("demo"),
    })),
    serverLang,
    usersByServer,
    unreachable,
  };
}

function instancesFor(email: string, fleet: FleetLanguages): string[] {
  const found: string[] = [];
  for (const [id, users] of fleet.usersByServer) {
    if (users.has(email)) found.push(id);
  }
  return found.sort();
}

function bucketFor(email: string, fleet: FleetLanguages): Bucket {
  const langs = new Set(
    instancesFor(email, fleet).map((id) => fleet.serverLang.get(id) ?? "en"),
  );
  if (langs.size > 1) return "multiple";
  if (langs.has("fr")) return "french-only";
  if (langs.has("pt")) return "portuguese-only";
  if (langs.has("en")) return "english-only";
  return "neither";
}

// Parallel-column CSV: each column is an independent list padded with "".
// Row i carries no cross-column meaning — this is the shape the existing
// export uses, so downstream consumers already expect it.
function bucketedCsv(
  emails: string[],
  fleet: FleetLanguages,
): { csv: string; counts: Record<Bucket, number> } {
  const cols: Record<Bucket, string[]> = {
    "french-only": [],
    "portuguese-only": [],
    "english-only": [],
    multiple: [],
    neither: [],
  };
  for (const email of emails) cols[bucketFor(email, fleet)].push(email);
  const height = Math.max(0, ...BUCKETS.map((b) => cols[b].length));
  const lines = [BUCKET_CSV_HEADER];
  for (let i = 0; i < height; i++) {
    lines.push(BUCKETS.map((b) => cols[b][i] ?? "").join(","));
  }
  return {
    csv: lines.join("\n") + "\n",
    counts: Object.fromEntries(
      BUCKETS.map((b) => [b, cols[b].length]),
    ) as Record<Bucket, number>,
  };
}

// Every email anywhere in the pasted text. Deliberately layout-agnostic: the
// list has already changed column shape once (4-col with "both" -> 5-col with
// "multiple", 2026-06-30), and an old export must still be usable as input.
function harvestEmails(text: string): Set<string> {
  const found = text.match(/[^@,\s"]+@[^@,\s"]+\.[^@,\s"]+/g) ?? [];
  return new Set(found.map((e) => e.trim().toLowerCase()));
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
      // Language is mutually exclusive per server, so a user lands in one
      // language bucket, "multiple" if they span languages, "neither" if on
      // no server. Shared with build_mailing_list and mirrors the
      // POST /language-report route.
      const fleet = await loadFleetLanguages();
      const buckets: Record<Bucket, string[]> = {
        "french-only": [],
        "portuguese-only": [],
        "english-only": [],
        multiple: [],
        neither: [],
      };
      for (const raw of state.emails) {
        const email = raw.toLowerCase();
        buckets[bucketFor(email, fleet)].push(email);
      }
      return okJson({
        trackedEmails: state.emails.length,
        listLastRefreshed: state.lastRunAt ? ms(state.lastRunAt) : null,
        counts: Object.fromEntries(
          Object.entries(buckets).map(([k, v]) => [k, v.length]),
        ),
        buckets,
        unreachable: fleet.unreachable.length
          ? { servers: fleet.unreachable, note: "Users only on these servers may be miscategorized as 'neither'." }
          : undefined,
      });
    }));

  server.registerTool("build_mailing_list", {
    title: "Refresh the support mailing list",
    description:
      "Given the mailing list you have today as CSV, find everyone active on any instance within the last N months who is NOT already on it, and return two CSVs: the new users alone, and the merged full list. Both use the language-bucket column layout (french_servers,portuguese_servers,english_servers,multiple,neither), so the output is a drop-in replacement for the existing export. Any input column layout is accepted — every email in the text counts as already-listed. Activity is the per-instance getCurrentUser login trail, which instances retain back to roughly 2026-04-05 only, so a window longer than that returns the same answer (the response reports the earliest activity actually seen). Language comes from which instances a user is registered on, not from where they were active. Read-only: does not modify the stored support list.",
    inputSchema: z.object({
      current_list_csv: z.string().min(1).describe(
        "The mailing list as it stands today, as CSV text. Column layout does not matter.",
      ),
      months: z.number().int().min(1).max(24).default(6).describe(
        "Activity window in months, counted back from today. Default 6.",
      ),
      exclude_demo_and_testing: z.boolean().default(false).describe(
        "Drop new users whose only instances are demo/testing boxes. Off by default so nothing is silently withheld; the response always lists them either way.",
      ),
    }),
    annotations: { readOnlyHint: true },
  }, ({ current_list_csv, months, exclude_demo_and_testing }) =>
    runTool(async () =>
      okJson(
        await buildMailingList(
          current_list_csv,
          months,
          exclude_demo_and_testing,
        ),
      )));

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

///////////////////////////////////////////////////////////////////////////////
// build_mailing_list — core
///////////////////////////////////////////////////////////////////////////////

// Exported so the computation can be exercised directly against the live fleet
// without standing up the MCP transport.
export async function buildMailingList(
  currentListCsv: string,
  months: number,
  excludeDemoAndTesting: boolean,
): Promise<Record<string, unknown>> {
  const existing = harvestEmails(currentListCsv);
  if (existing.size === 0) {
    throw new ToolFailure(
      "No email addresses found in current_list_csv. Paste the CSV contents themselves, not a filename or a summary.",
    );
  }
  const cutoff = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const fleet = await loadFleetLanguages();

  // /user_logs is the getCurrentUser login trail and is never purged, unlike
  // user_logs_aggregate — which excludes getCurrentUser entirely and so cannot
  // see a user who only signs in and reads.
  const logsUnreachable: string[] = [];
  const lastActive = new Map<string, string>();
  // Each worker returns the oldest day it saw; reduced after the fan-out
  // rather than folded into an outer variable, which the closure would hide
  // from control-flow narrowing.
  const earliestPerServer = await mapConcurrent(
    fleet.servers,
    8,
    async ({ id }): Promise<string | null> => {
      let payload: unknown;
      try {
        payload = await fetchInstanceJson(id, "user_logs");
      } catch {
        logsUnreachable.push(id);
        return null;
      }
      const rows = (Array.isArray(payload)
        ? payload
        : (payload as { logs?: unknown[] })?.logs ?? []) as {
          user_email?: string;
          timestamp?: string;
        }[];
      let earliest: string | null = null;
      for (const row of rows) {
        const day = (row.timestamp ?? "").slice(0, 10);
        const email = (row.user_email ?? "").trim().toLowerCase();
        if (!day || !email) continue;
        if (earliest === null || day < earliest) earliest = day;
        if (day < cutoff) continue;
        const prev = lastActive.get(email);
        if (prev === undefined || day > prev) lastActive.set(email, day);
      }
      return earliest;
    },
  );
  const earliestSeen = earliestPerServer
    .filter((d): d is string => d !== null)
    .sort()[0] ?? null;

  const active = [...lastActive.keys()].sort();
  let newcomers = active.filter((e) => !existing.has(e));
  const demoOrTesting = new Set(
    fleet.servers.filter((s) => s.isDemoOrTesting).map((s) => s.id),
  );
  const onlyDemoOrTesting = newcomers.filter((e) => {
    const on = instancesFor(e, fleet);
    return on.length > 0 && on.every((id) => demoOrTesting.has(id));
  });
  if (excludeDemoAndTesting) {
    const drop = new Set(onlyDemoOrTesting);
    newcomers = newcomers.filter((e) => !drop.has(e));
  }
  const full = [...new Set([...existing, ...newcomers])].sort();

  const newCsv = bucketedCsv(newcomers, fleet);
  const fullCsv = bucketedCsv(full, fleet);
  const unreachable = [...new Set([...fleet.unreachable, ...logsUnreachable])];

  return {
    window: {
      months,
      cutoff,
      earliestActivityAvailable: earliestSeen,
      note: earliestSeen !== null && earliestSeen > cutoff
        ? `Instances only retain activity back to ${earliestSeen}, later than the ${months}-month cutoff of ${cutoff}. The effective window is ${earliestSeen} to today.`
        : null,
    },
    counts: {
      alreadyOnList: existing.size,
      activeInWindow: active.length,
      newUsers: newcomers.length,
      fullList: full.length,
    },
    newUsersByBucket: newCsv.counts,
    fullListByBucket: fullCsv.counts,
    newUsersCsv: newCsv.csv,
    fullListCsv: fullCsv.csv,
    newUsersOnlyOnDemoOrTesting: {
      emails: onlyDemoOrTesting,
      excluded: excludeDemoAndTesting,
      note: excludeDemoAndTesting
        ? "Excluded from both CSVs."
        : "Included in both CSVs. Re-run with exclude_demo_and_testing:true to drop them.",
    },
    unreachable: unreachable.length
      ? {
        servers: unreachable,
        note:
          "These instances answered nothing, so their users may be missing from the active set and miscategorized as 'neither'.",
      }
      : undefined,
  };
}
