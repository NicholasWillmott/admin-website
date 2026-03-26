/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";

const router = new Hono();

interface UserLog {
    user_email: string;
    endpoint: string;
    timestamp: string;
}

interface Server {
    id: string;
    label: string;
}

interface ClerkUser {
    first_name: string | null;
    last_name: string | null;
    email_addresses: { id: string; email_address: string }[];
    primary_email_address_id: string | null;
    created_at: number;
    public_metadata: Record<string, unknown>;
}

function getPrimaryEmail(user: ClerkUser): string {
    const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
    return primary?.email_address ?? user.email_addresses[0]?.email_address ?? "";
}

async function fetchAllUsers(): Promise<ClerkUser[]> {
    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const response = await fetch("https://api.clerk.com/v1/users?limit=500", {
        headers: { Authorization: `Bearer ${clerkSecretKey}` },
    });
    return response.json();
}

async function fetchServers(): Promise<Server[]> {
    const response = await fetch("https://central.fastr-analytics.org/servers.json");
    return response.json();
}

interface SuperAdminEmailState {
    lastSentAt: number;
    knownInstanceIds: string[];
    knownProjects: Record<string, string[]>;
    knownVersions: Record<string, string>;
    knownUserCounts: Record<string, number>;
    knownTotalUsers: number;
}

const STATE_FILE = "/mnt/fastr-config/superadmin-email-state.json";
const INSTANCE_ADMIN_STATE_FILE = "/mnt/fastr-config/instance-admin-email-state.json";

interface InstanceAdminEmailState {
    knownProjects: Record<string, string[]>;
    knownUserCounts: Record<string, number>;
}

async function readInstanceAdminEmailState(): Promise<InstanceAdminEmailState | null> {
    try {
        return JSON.parse(await Deno.readTextFile(INSTANCE_ADMIN_STATE_FILE));
    } catch {
        return null;
    }
}

async function writeInstanceAdminEmailState(state: InstanceAdminEmailState): Promise<void> {
    await Deno.mkdir("/mnt/fastr-config", { recursive: true });
    await Deno.writeTextFile(INSTANCE_ADMIN_STATE_FILE, JSON.stringify(state));
}

async function readEmailState(): Promise<SuperAdminEmailState | null> {
    try {
        return JSON.parse(await Deno.readTextFile(STATE_FILE));
    } catch {
        return null;
    }
}

async function writeEmailState(state: SuperAdminEmailState): Promise<void> {
    await Deno.mkdir("/mnt/fastr-config", { recursive: true });
    await Deno.writeTextFile(STATE_FILE, JSON.stringify(state));
}

async function fetchServerProjects(serverId: string): Promise<string[]> {
    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/projects`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.projects ?? [];
    } catch {
        return [];
    }
}

async function fetchServerHealth(serverId: string): Promise<{ version: string; userCount: number; adminUsers: string[] }> {
    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/health_check`);
        if (!response.ok) return { version: "", userCount: 0, adminUsers: [] };
        const data = await response.json();
        return { version: data.serverVersion ?? "", userCount: data.totalUsers ?? 0, adminUsers: data.adminUsers ?? [] };
    } catch {
        return { version: "", userCount: 0, adminUsers: [] };
    }
}

async function fetchServerUserLogs(serverId: string): Promise<UserLog[]> {
    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/user_logs`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.logs ?? [];
    } catch {
        return [];
    }
}


function buildSuperAdminEmailHtml(
    weekStart: string,
    weekEnd: string,
    totalUsers: number,
    totalUsersDiff: number,
    totalActiveUsers: number,
    instanceStats: { label: string; id: string; activeUsers: number; version: string; versionIsNew: boolean; projectCount: number; userCount: number; userCountDiff: number }[],
    recentSignups: { name: string; email: string; joinedDate: string }[],
    newInstanceIds: Set<string>,
    newProjects: { instanceLabel: string; project: string }[]
): string {
    const sortedInstances = instanceStats.sort((a, b) => b.activeUsers - a.activeUsers);
    const displayedInstances = sortedInstances.slice(0, 50);
    const instanceRows = displayedInstances.map(inst => {
        const isNew = newInstanceIds.has(inst.id);
        const newBadge = isNew ? `<span class="badge">New</span>` : "";
        const versionBadge = inst.versionIsNew ? `<span class="badge">New</span>` : "";
        const diffFlair = inst.userCountDiff > 0
            ? `<span class="diff-up">+${inst.userCountDiff}</span>`
            : inst.userCountDiff < 0
                ? `<span class="diff-dn">${inst.userCountDiff}</span>`
                : "";
        return `<tr><td>${inst.label}${newBadge}</td><td class="m">${inst.id}</td><td class="m">${inst.version}${versionBadge}</td><td class="c">${inst.projectCount}</td><td class="c">${inst.userCount}${diffFlair}</td><td class="c">${inst.activeUsers}</td></tr>`;
    }).join("");

    const instancesHiddenCount = sortedInstances.length - displayedInstances.length;
    const instancesHiddenNote = instancesHiddenCount > 0
        ? `<tr><td colspan="6" class="note">+ ${instancesHiddenCount} more instances not shown</td></tr>`
        : "";

    const displayedSignups = recentSignups.slice(0, 30);
    const signupsHiddenCount = recentSignups.length - displayedSignups.length;
    const signupsHiddenNote = signupsHiddenCount > 0
        ? `<tr><td colspan="3" class="note">+ ${signupsHiddenCount} more signups not shown</td></tr>`
        : "";
    const signupRows = displayedSignups.length > 0
        ? displayedSignups.map(u => `<tr><td>${u.name}</td><td class="m">${u.email}</td><td class="m">${u.joinedDate}</td></tr>`).join("") + signupsHiddenNote
        : `<tr><td colspan="3" class="empty">No new signups this week</td></tr>`;

    return `<!DOCTYPE html>
<html>
<head>
<style>
body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#f2f2f2;margin:0;padding:32px}
.wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:4px;overflow:hidden;border:1px solid #cacaca}
.hdr{background:#0e706c;padding:28px 32px}
.hdr h1{color:#fff;margin:0;font-size:20px;font-weight:700}
.hdr p{color:rgba(255,255,255,.7);margin:4px 0 0;font-size:14px}
.bdy{padding:28px 32px}
.stat{background:#f2f2f2;border-radius:4px;padding:20px 24px;margin-bottom:28px;border:1px solid #cacaca}
.stat-lbl{font-size:11px;color:#2a2a2a;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.stat-val{font-size:40px;font-weight:700;color:#0e706c;margin-top:4px}
h2{font-size:13px;font-weight:700;color:#2a2a2a;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;font-size:14px;color:#2a2a2a;margin-bottom:32px;border:1px solid #cacaca;border-radius:4px}
thead tr{background:#f2f2f2}
th{padding:10px 16px;text-align:left;font-weight:700;color:#2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #cacaca}
th.c{text-align:center}
td{padding:10px 16px;border-bottom:1px solid #cacaca;color:#2a2a2a}
td.m{color:#a1a1a1;font-size:13px}
td.c{text-align:center;font-weight:700;color:#0e706c}
td.note{text-align:center;color:#a1a1a1;font-size:12px}
td.empty{padding:16px;text-align:center;color:#a1a1a1}
.badge{margin-left:8px;background:#0e706c;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:2px;text-transform:uppercase;letter-spacing:.06em;vertical-align:middle}
.diff-up{margin-left:6px;color:#0e706c;font-size:11px;font-weight:700;vertical-align:middle}
.diff-dn{margin-left:6px;color:#c0392b;font-size:11px;font-weight:700;vertical-align:middle}
.sdiff-up{margin-left:10px;color:#0e706c;font-size:18px;font-weight:700;vertical-align:middle}
.sdiff-dn{margin-left:10px;color:#c0392b;font-size:18px;font-weight:700;vertical-align:middle}
.ftr{padding:16px 32px;border-top:1px solid #cacaca;text-align:center}
.ftr p{margin:0;font-size:12px;color:#a1a1a1}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>Weekly Analytics Report</h1>
    <p>${weekStart} – ${weekEnd}</p>
  </div>
  <div class="bdy">
    <div class="stat">
      <div class="stat-lbl">Total Users</div>
      <div class="stat-val">${totalUsers}${totalUsersDiff > 0 ? `<span class="sdiff-up">+${totalUsersDiff}</span>` : totalUsersDiff < 0 ? `<span class="sdiff-dn">${totalUsersDiff}</span>` : ""}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">Total Active Users (7 days)</div>
      <div class="stat-val">${totalActiveUsers}</div>
    </div>
    <h2>Instance Info</h2>
    <table>
      <thead><tr><th>Instance</th><th>ID</th><th>Version</th><th class="c">Projects</th><th class="c">Users</th><th class="c">Active Users</th></tr></thead>
      <tbody>${instanceRows}${instancesHiddenNote}</tbody>
    </table>
    ${newProjects.length > 0 ? `
    <h2>New Projects (${newProjects.length})</h2>
    <table>
      <thead><tr><th>Project</th><th>Instance</th></tr></thead>
      <tbody>${newProjects.map(p => `<tr><td>${p.project}<span class="badge">New</span></td><td class="m">${p.instanceLabel}</td></tr>`).join("")}</tbody>
    </table>` : ""}
    <h2>New Signups (${recentSignups.length})</h2>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Joined</th></tr></thead>
      <tbody>${signupRows}</tbody>
    </table>
  </div>
  <div class="ftr"><p>Fastr Analytics Admin · Automated weekly report</p></div>
</div>
</body>
</html>`;
}

function buildInstanceAdminEmailHtml(
    weekStart: string,
    weekEnd: string,
    instanceLabel: string,
    instanceId: string,
    version: string,
    userCount: number,
    userCountDiff: number,
    activeUsers: number,
    projects: string[],
    newProjects: string[],
    recentLogs: UserLog[]
): string {
    const projectRows = projects.map(p => {
        const isNew = newProjects.includes(p);
        const newBadge = isNew ? `<span class="badge">New</span>` : "";
        return `<tr><td>${p}${newBadge}</td></tr>`;
    }).join("") || `<tr><td class="empty">No projects</td></tr>`;

    const chartDays: string[] = [];
    const chartCounts: number[] = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        chartDays.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        const uniqueUsers = new Set(recentLogs.filter(l => {
            const t = new Date(l.timestamp).getTime();
            return t >= dayStart && t < dayEnd;
        }).map(l => l.user_email));
        chartCounts.push(uniqueUsers.size);
    }
    const chartConfig = {
        type: "bar",
        data: {
            labels: chartDays,
            datasets: [{ data: chartCounts, backgroundColor: "#0e706c", borderRadius: 3 }],
        },
        options: {
            legend: { display: false },
            scales: { yAxes: [{ ticks: { beginAtZero: true, precision: 0 } }] },
        },
    };
    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=576&h=260&bkg=%23ffffff`;

    const diffFlair = userCountDiff > 0
        ? `<span class="sdiff-up">+${userCountDiff}</span>`
        : userCountDiff < 0
            ? `<span class="sdiff-dn">${userCountDiff}</span>`
            : "";

    return `<!DOCTYPE html>
<html>
<head>
<style>
body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#f2f2f2;margin:0;padding:32px}
.wrap{max-width:640px;margin:0 auto;background:#fff;border-radius:4px;overflow:hidden;border:1px solid #cacaca}
.hdr{background:#0e706c;padding:28px 32px}
.hdr h1{color:#fff;margin:0;font-size:20px;font-weight:700}
.hdr p{color:rgba(255,255,255,.7);margin:4px 0 0;font-size:14px}
.bdy{padding:28px 32px}
.stat{background:#f2f2f2;border-radius:4px;padding:20px 24px;margin-bottom:16px;border:1px solid #cacaca}
.stat-lbl{font-size:11px;color:#2a2a2a;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.stat-val{font-size:40px;font-weight:700;color:#0e706c;margin-top:4px}
h2{font-size:13px;font-weight:700;color:#2a2a2a;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;font-size:14px;color:#2a2a2a;margin-bottom:32px;border:1px solid #cacaca;border-radius:4px}
thead tr{background:#f2f2f2}
th{padding:10px 16px;text-align:left;font-weight:700;color:#2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #cacaca}
td{padding:10px 16px;border-bottom:1px solid #cacaca;color:#2a2a2a}
td.m{color:#a1a1a1;font-size:13px}
td.note{text-align:center;color:#a1a1a1;font-size:12px}
td.empty{padding:16px;text-align:center;color:#a1a1a1}
.badge{margin-left:8px;background:#0e706c;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:2px;text-transform:uppercase;letter-spacing:.06em;vertical-align:middle}
.sdiff-up{margin-left:10px;color:#0e706c;font-size:18px;font-weight:700;vertical-align:middle}
.sdiff-dn{margin-left:10px;color:#c0392b;font-size:18px;font-weight:700;vertical-align:middle}
.meta{font-size:12px;color:#a1a1a1;margin-bottom:28px}
.ftr{padding:16px 32px;border-top:1px solid #cacaca;text-align:center}
.ftr p{margin:0;font-size:12px;color:#a1a1a1}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>${instanceLabel} — Weekly Report</h1>
    <p>${weekStart} – ${weekEnd}</p>
  </div>
  <div class="bdy">
    <p class="meta">Instance ID: ${instanceId} &nbsp;·&nbsp; Version: ${version || "—"}</p>
    <div class="stat">
      <div class="stat-lbl">Total Users</div>
      <div class="stat-val">${userCount}${diffFlair}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">Active Users (7 days)</div>
      <div class="stat-val">${activeUsers}</div>
    </div>
    <h2>Projects (${projects.length})</h2>
    <table>
      <thead><tr><th>Project</th></tr></thead>
      <tbody>${projectRows}</tbody>
    </table>
    <h2>Active Users — Last 7 Days</h2>
    <img src="${chartUrl}" width="576" alt="Active users per day" style="display:block;border-radius:4px;border:1px solid #cacaca;margin-bottom:32px" />
  </div>
  <div class="ftr"><p>Fastr Analytics · Automated weekly report for ${instanceLabel}</p></div>
</div>
</body>
</html>`;
}

async function sendEmail(toEmails: string[], subject: string, html: string): Promise<void> {
    const sendGridKey = Deno.env.get("SEND_GRID_API");
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${sendGridKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            personalizations: [{ to: toEmails.map(email => ({ email })) }],
            from: { email: "noreply@fastr-analytics.org", name: "Fastr Analytics" },
            subject,
            content: [{ type: "text/html", value: html }],
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`SendGrid error ${response.status}: ${err}`);
    }
}

router.post("/superadmin-email", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    try {
        const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const weekStart = fmt(new Date(weekAgoMs));
        const weekEnd = fmt(new Date());

        const [allUsers, servers] = await Promise.all([
            fetchAllUsers(),
            fetchServers(),
        ]);

        const adminEmails = ["nicholaswillmottvball@gmail.com"];

        const recentSignups = allUsers
            .filter(u => u.created_at >= weekAgoMs)
            .sort((a, b) => b.created_at - a.created_at)
            .map(u => ({
                name: [u.first_name, u.last_name].filter(Boolean).join(" ") || "—",
                email: getPrimaryEmail(u),
                joinedDate: fmt(new Date(u.created_at)),
            }));

        const [logResults, state] = await Promise.all([
            Promise.all(servers.map(async (server: Server) => ({
                server,
                logs: await fetchServerUserLogs(server.id),
                projects: await fetchServerProjects(server.id),
                health: await fetchServerHealth(server.id),
            }))),
            readEmailState(),
        ]);

        const knownIds = new Set(state?.knownInstanceIds ?? []);
        const newInstanceIds = new Set(servers.filter(s => !knownIds.has(s.id)).map(s => s.id));
        const knownVersions = state?.knownVersions ?? {};
        const knownUserCounts = state?.knownUserCounts ?? {};
        const knownProjects = state?.knownProjects ?? {};

        const allActiveUsers = new Set<string>();
        const instanceStats = logResults.map(({ server, logs, health, projects }) => {
            const recentLogs = logs.filter((l: UserLog) => new Date(l.timestamp).getTime() >= weekAgoMs);
            const uniqueUsers = new Set(recentLogs.map((l: UserLog) => l.user_email));
            uniqueUsers.forEach((u: string) => allActiveUsers.add(u));
            const versionIsNew = (server.id in knownVersions) && knownVersions[server.id] !== health.version && health.version !== "";
            const userCountDiff = (server.id in knownUserCounts) ? health.userCount - knownUserCounts[server.id] : 0;
            return { label: server.label, id: server.id, activeUsers: uniqueUsers.size, version: health.version, versionIsNew, projectCount: projects.length, userCount: health.userCount, userCountDiff };
        });

        const newProjects: { instanceLabel: string; project: string }[] = [];
        const currentProjects: Record<string, string[]> = {};
        const currentVersions: Record<string, string> = {};
        const currentUserCounts: Record<string, number> = {};
        for (const { server, projects, health } of logResults) {
            currentProjects[server.id] = projects;
            currentVersions[server.id] = health.version;
            currentUserCounts[server.id] = health.userCount;
            const previouslyKnown = new Set(knownProjects[server.id] ?? []);
            for (const project of projects) {
                if (!previouslyKnown.has(project)) {
                    newProjects.push({ instanceLabel: server.label, project });
                }
            }
        }

        const totalUsers = allUsers.length;
        const totalUsersDiff = state?.knownTotalUsers !== undefined ? totalUsers - state.knownTotalUsers : 0;

        const subject = `Weekly Analytics Report · ${weekStart} – ${weekEnd}`;
        const html = buildSuperAdminEmailHtml(weekStart, weekEnd, totalUsers, totalUsersDiff, allActiveUsers.size, instanceStats, recentSignups, newInstanceIds, newProjects);

        await sendEmail(adminEmails, subject, html);
        await writeEmailState({ lastSentAt: Date.now(), knownInstanceIds: servers.map(s => s.id), knownProjects: currentProjects, knownVersions: currentVersions, knownUserCounts: currentUserCounts, knownTotalUsers: totalUsers });

        return c.json({ success: true, sentTo: adminEmails.length });
    } catch (error) {
        console.error("Failed to send weekly report:", error);
        return c.json({ error: String(error) }, 500);
    }
});

router.post("/instance-admin-emails", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    try {
        const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const weekStart = fmt(new Date(weekAgoMs));
        const weekEnd = fmt(new Date());

        const [servers, state] = await Promise.all([
            fetchServers(),
            readInstanceAdminEmailState(),
        ]);

        const knownUserCounts = state?.knownUserCounts ?? {};
        const knownProjects = state?.knownProjects ?? {};

        const results = await Promise.all(servers.map(async (server: Server) => ({
            server,
            logs: await fetchServerUserLogs(server.id),
            projects: await fetchServerProjects(server.id),
            health: await fetchServerHealth(server.id),
        })));

        let emailsSent = 0;
        const subject = (label: string) => `${label} Weekly Report · ${weekStart} – ${weekEnd}`;

        const testOverrideEmail = "nicholaswillmottvball@gmail.com";

        const newKnownProjects: Record<string, string[]> = {};
        const newKnownUserCounts: Record<string, number> = {};

        for (const { server, logs, projects, health } of results) {
            newKnownProjects[server.id] = projects;
            newKnownUserCounts[server.id] = health.userCount;

            if (health.adminUsers.length === 0) continue;

            const recentLogs = logs.filter((l: UserLog) => new Date(l.timestamp).getTime() >= weekAgoMs);
            const activeUsers = new Set(recentLogs.map((l: UserLog) => l.user_email)).size;
            const userCountDiff = (server.id in knownUserCounts) ? health.userCount - knownUserCounts[server.id] : 0;
            const previouslyKnown = new Set(knownProjects[server.id] ?? []);
            const newProjects = projects.filter(p => !previouslyKnown.has(p));

            const html = buildInstanceAdminEmailHtml(
                weekStart, weekEnd,
                server.label, server.id,
                health.version, health.userCount, userCountDiff,
                activeUsers, projects, newProjects, recentLogs
            );

            await sendEmail([testOverrideEmail], subject(server.label), html);
            emailsSent += 1;
        }

        await writeInstanceAdminEmailState({ knownProjects: newKnownProjects, knownUserCounts: newKnownUserCounts });

        return c.json({ success: true, emailsSent });
    } catch (error) {
        console.error("Failed to send instance admin emails:", error);
        return c.json({ error: String(error) }, 500);
    }
});

export default router;