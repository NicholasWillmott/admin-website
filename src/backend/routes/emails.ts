/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdminOrInternal } from "../lib/auth.ts";
import { H_USERS } from "../../frontend/h_users.ts";
import type { AiUsageLog, ModelPricing } from "../../frontend/types.ts";

const router = new Hono();

interface UserLog {
    user_email: string;
    endpoint: string;
    timestamp: string;
    project_id: string | null;
}

interface Server {
    id: string;
    label: string;
    serverVersion: string;
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
    const all: ClerkUser[] = [];
    const limit = 500;
    let offset = 0;
    while (true) {
        const response = await fetch(`https://api.clerk.com/v1/users?limit=${limit}&offset=${offset}`, {
            headers: { Authorization: `Bearer ${clerkSecretKey}` },
        });
        const page: ClerkUser[] = await response.json();
        all.push(...page);
        if (page.length < limit) break;
        offset += limit;
    }
    return all;
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
    knownVersions: Record<string, string>;
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

async function fetchServerHealth(serverId: string): Promise<{ online: boolean; version: string; userCount: number; adminUsers: string[] }> {
    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/health_check`);
        if (!response.ok) return { online: false, version: "", userCount: 0, adminUsers: [] };
        const data = await response.json();
        return { online: true, version: data.serverVersion ?? "", userCount: data.totalUsers ?? 0, adminUsers: data.adminUsers ?? [] };
    } catch {
        return { online: false, version: "", userCount: 0, adminUsers: [] };
    }
}

async function fetchChangelogAuto(): Promise<string> {
    const { readChangelogAuto } = await import("./changelog.ts");
    return readChangelogAuto();
}

function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    }
    return 0;
}

// Parse flat CHANGELOG_AUTO.txt lines of the form:
// [version] [audience] [type] - Description
// Returns HTML for lines matching the given audience that are newer than sinceVersion.
function parseAutoChangelogSince(changelog: string, audience: "user" | "admin" | ("user" | "admin")[], sinceVersion: string): { html: string; text: string } {
    const audiences = Array.isArray(audience) ? audience : [audience];
    const lines = changelog.split("\n").filter(l => l.trim().startsWith(`[`) && audiences.some(a => l.includes(`] [${a}]`)));
    const filtered = lines.filter(line => {
        const m = line.match(/^\[([^\]]+)\]/);
        if (!m || m[1] === "TBD") return false;
        return compareVersions(m[1], sinceVersion) > 0;
    });
    if (filtered.length === 0) return { html: "", text: "" };
    const items = filtered.map(line => {
        const m = line.match(/^\[([^\]]+)\] \[[^\]]+\] \[([^\]]+)\] - (.+)$/);
        const version = m?.[1] ?? "";
        const type = m?.[2] ?? "";
        const desc = m?.[3] ?? line;
        return { version, type, desc };
    });
    // Group by version (newest first), then by type within each version
    const byVersion = new Map<string, Map<string, string[]>>();
    for (const { version, type, desc } of items) {
        if (!byVersion.has(version)) byVersion.set(version, new Map());
        const byType = byVersion.get(version)!;
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(desc);
    }
    const sortedVersions = [...byVersion.keys()].sort((a, b) => compareVersions(b, a));
    let html = "";
    for (const version of sortedVersions) {
        const byType = byVersion.get(version)!;
        html += `<div class="changelog-entry"><h3>v${version}</h3>`;
        for (const [type, descs] of byType) {
            html += `<strong>${type.charAt(0).toUpperCase() + type.slice(1)}</strong><ul>`;
            html += descs.map(d => `<li>${d}</li>`).join("");
            html += `</ul>`;
        }
        html += `</div>`;
    }
    const text = filtered.map(l => l.replace(/^\[[^\]]+\] \[[^\]]+\] /, "")).join("\n");
    return { html: `<div class="changelog">${html}</div>`, text };
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

async function fetchServerAiUsageLogs(serverId: string): Promise<AiUsageLog[]> {
    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/ai_usage`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.logs ?? [];
    } catch {
        return [];
    }
}

async function fetchModelPricing(): Promise<Record<string, ModelPricing>> {
    try {
        const response = await fetch("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json");
        if (!response.ok) return {};
        return await response.json();
    } catch {
        return {};
    }
}

function computeAiCost(logs: AiUsageLog[], pricing: Record<string, ModelPricing>): number {
    return logs.reduce((total, log) => {
        const p = pricing[log.model];
        if (!p) return total;
        return total
            + (log.input_tokens * (p.input_cost_per_token ?? 0))
            + (log.output_tokens * (p.output_cost_per_token ?? 0))
            + (log.cache_creation_input_tokens * (p.cache_creation_input_token_cost ?? 0))
            + (log.cache_read_input_tokens * (p.cache_read_input_token_cost ?? 0));
    }, 0);
}

function formatAiCost(cost: number): string {
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `${(cost * 100).toFixed(3)}¢`;
    return `$${cost.toFixed(2)}`;
}


function buildSuperAdminEmailHtml(
    weekStart: string,
    weekEnd: string,
    totalUsers: number,
    totalUsersDiff: number,
    totalActiveUsers: number,
    instanceStats: { label: string; id: string; activeUsers: number; version: string; versionIsNew: boolean; projectCount: number; userCount: number; userCountDiff: number; aiCostUsd: number }[],
    recentSignups: { name: string; email: string; joinedDate: string }[],
    newInstanceIds: Set<string>,
    newProjects: { instanceLabel: string; project: string }[],
    aiSummary: string,
    changelogHtml: string
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
        return `<tr><td>${inst.label}${newBadge}</td><td class="m">${inst.version}${versionBadge}</td><td class="c">${inst.projectCount}</td><td class="c">${inst.userCount}${diffFlair}</td><td class="c">${inst.activeUsers}</td><td class="c">${formatAiCost(inst.aiCostUsd)}</td></tr>`;
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
        ? displayedSignups.map(u => {
            const [local, domain] = u.email.split("@");
            const broken = domain ? `${local}<span></span>@${domain.replace(/\./g, "<span></span>.")}` : u.email;
            return `<tr><td>${u.name}</td><td class="m"><span style="color:#1a73e8">${broken}</span></td><td class="m">${u.joinedDate}</td></tr>`;
        }).join("") + signupsHiddenNote
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
.diff-up{margin-left:8px;background:#d4edda;color:#155724;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;vertical-align:middle;display:inline-block}
.diff-dn{margin-left:8px;background:#f8d7da;color:#721c24;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;vertical-align:middle;display:inline-block}
.sdiff-up{margin-left:12px;background:#d4edda;color:#155724;font-size:16px;font-weight:700;padding:4px 12px;border-radius:12px;vertical-align:middle;display:inline-block}
.sdiff-dn{margin-left:12px;background:#f8d7da;color:#721c24;font-size:16px;font-weight:700;padding:4px 12px;border-radius:12px;vertical-align:middle;display:inline-block}
.ftr{padding:16px 32px;border-top:1px solid #cacaca;text-align:center}
.ftr p{margin:0;font-size:12px;color:#a1a1a1}
.ai-summary{background:#f7fffe;border:1px solid #0e706c;border-radius:4px;padding:20px 24px;margin-bottom:28px}
.ai-summary-lbl{font-size:11px;color:#0e706c;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px}
.ai-summary-text{font-size:14px;color:#2a2a2a;line-height:1.6;margin:0}
.changelog{margin-bottom:32px}
.changelog-entry{margin-bottom:20px}
.changelog-entry h3{font-size:13px;font-weight:700;color:#2a2a2a;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em}
.changelog-entry strong{display:block;font-size:11px;color:#0e706c;text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px}
.changelog-entry ul{margin:0;padding-left:18px}
.changelog-entry li{font-size:14px;color:#2a2a2a;margin-bottom:3px}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>Weekly Analytics Report</h1>
    <p>${weekStart} – ${weekEnd}</p>
  </div>
  <div class="bdy">
    ${aiSummary ? `<div class="ai-summary"><div class="ai-summary-lbl">AI Summary</div><p class="ai-summary-text">${aiSummary}</p></div>` : ""}
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
      <thead><tr><th>Instance</th><th>Version</th><th class="c">Projects</th><th class="c">Users</th><th class="c">Active Users</th><th class="c">AI Cost</th></tr></thead>
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
    ${changelogHtml ? `<h2>What's New</h2>${changelogHtml}` : ""}
  </div>
  <div class="ftr"><p>Fastr Analytics Admin · Automated weekly report</p></div>
</div>
</body>
</html>`;
}

async function generateInstanceAiSummary(data: {
    weekStart: string;
    weekEnd: string;
    instanceLabel: string;
    version: string;
    userCount: number;
    userCountDiff: number;
    activeUsers: number;
    newProjects: string[];
    changelogText: string;
    aiCostUsd: number;
}): Promise<string> {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return "";

    const prompt = `You are writing a brief summary for a weekly instance report sent to the admin of a FASTR Analytics instance called "${data.instanceLabel}". Be concise (2-4 sentences), factual, and highlight the most notable activity or changes. Use plain language — no markdown, no bullet points, just flowing prose.

Here is the data for the week of ${data.weekStart} to ${data.weekEnd}:

- Total users: ${data.userCount} (change from last week: ${data.userCountDiff > 0 ? "+" : ""}${data.userCountDiff})
- Active users (last 7 days): ${data.activeUsers}
- New projects this week: ${data.newProjects.length > 0 ? data.newProjects.join(", ") : "none"}
- Platform version: ${data.version || "unknown"}
- AI cost this week: ${formatAiCost(data.aiCostUsd)}
${data.changelogText ? `\nNew platform changes deployed to this instance:\n${data.changelogText}` : ""}
Write the summary now:`;

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 200,
                messages: [{ role: "user", content: prompt }],
            }),
        });

        if (!response.ok) return "";
        const result = await response.json();
        return result.content?.[0]?.text ?? "";
    } catch {
        return "";
    }
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
    projectsSortedByActivity: { name: string; requests: number; isNew: boolean }[],
    recentLogs: UserLog[],
    changelogHtml: string,
    aiSummary: string,
    aiCostUsd: number,
    topUsers: [string, number][]
): string {
    const projectRows = projectsSortedByActivity.map(p => {
        const newBadge = p.isNew ? `<span class="badge">New</span>` : "";
        const reqCell = p.requests > 0 ? `<td class="c">${p.requests}</td>` : `<td class="c" style="color:#a1a1a1">—</td>`;
        return `<tr><td>${p.name}${newBadge}</td>${reqCell}</tr>`;
    }).join("") || `<tr><td colspan="2" class="empty">No projects</td></tr>`;

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

    const topUserRows = topUsers.length > 0
        ? topUsers.map(([email, count]) => {
            const [local, domain] = email.split("@");
            const broken = domain ? `${local}<span></span>@${domain.replace(/\./g, "<span></span>.")}` : email;
            return `<tr><td><span style="color:#1a73e8">${broken}</span></td><td class="c">${count}</td></tr>`;
        }).join("")
        : `<tr><td colspan="2" class="empty">No activity this week</td></tr>`;

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
.sdiff-up{margin-left:12px;background:#d4edda;color:#155724;font-size:16px;font-weight:700;padding:4px 12px;border-radius:12px;vertical-align:middle;display:inline-block}
.sdiff-dn{margin-left:12px;background:#f8d7da;color:#721c24;font-size:16px;font-weight:700;padding:4px 12px;border-radius:12px;vertical-align:middle;display:inline-block}
.meta{font-size:12px;color:#a1a1a1;margin-bottom:28px}
.changelog{margin-bottom:32px}
.changelog-entry{margin-bottom:20px}
.changelog-entry h3{font-size:13px;font-weight:700;color:#2a2a2a;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em}
.changelog-entry strong{display:block;font-size:11px;color:#0e706c;text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px}
.changelog-entry ul{margin:0;padding-left:18px}
.changelog-entry li{font-size:14px;color:#2a2a2a;margin-bottom:3px}
.ftr{padding:16px 32px;border-top:1px solid #cacaca;text-align:center}
.ftr p{margin:0;font-size:12px;color:#a1a1a1}
.ai-summary{background:#f7fffe;border:1px solid #0e706c;border-radius:4px;padding:20px 24px;margin-bottom:28px}
.ai-summary-lbl{font-size:11px;color:#0e706c;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:8px}
.ai-summary-text{font-size:14px;color:#2a2a2a;line-height:1.6;margin:0}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>${instanceLabel} — Weekly Report</h1>
    <p>${weekStart} – ${weekEnd}</p>
  </div>
  <div class="bdy">
    <p class="meta">This is an automated weekly report sent to all admins of the <strong>${instanceLabel}</strong> FASTR Analytics Platform.</p>
    ${aiSummary ? `<div class="ai-summary"><div class="ai-summary-lbl">AI Summary</div><p class="ai-summary-text">${aiSummary}</p></div>` : ""}
    <p class="meta">Instance ID: ${instanceId} &nbsp;·&nbsp; Version: ${version || "—"}</p>
    <div class="stat">
      <div class="stat-lbl">Total Users</div>
      <div class="stat-val">${userCount}${diffFlair}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">Active Users (7 days)</div>
      <div class="stat-val">${activeUsers}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">AI Cost (7 days)</div>
      <div class="stat-val">${formatAiCost(aiCostUsd)}</div>
    </div>
    <h2>Projects (${projectsSortedByActivity.length})</h2>
    <table>
      <thead><tr><th>Project</th><th class="c">Requests (7 days)</th></tr></thead>
      <tbody>${projectRows}</tbody>
    </table>
    <h2>Active Users — Last 7 Days</h2>
    <img src="${chartUrl}" width="576" alt="Active users per day" style="display:block;border-radius:4px;border:1px solid #cacaca;margin-bottom:32px" />
    <h2>Top Active Users</h2>
    <table>
      <thead><tr><th>User</th><th class="c">Requests</th></tr></thead>
      <tbody>${topUserRows}</tbody>
    </table>
    ${changelogHtml ? `<h2>What's New</h2>${changelogHtml}` : ""}
  </div>
  <div class="ftr"><p>Fastr Analytics · Automated weekly report for ${instanceLabel}</p></div>
</div>
</body>
</html>`;
}

async function generateAiSummary(data: {
    weekStart: string;
    weekEnd: string;
    totalUsers: number;
    totalUsersDiff: number;
    totalActiveUsers: number;
    newSignups: number;
    newInstances: number;
    newProjects: { instanceLabel: string; project: string }[];
    instanceStats: { label: string; activeUsers: number; version: string; versionIsNew: boolean; userCount: number; userCountDiff: number }[];
    changelogText: string;
}): Promise<string> {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return "";

    const prompt = `You are writing a brief executive summary for a weekly analytics platform report. Be concise (3-5 sentences), factual, and highlight the most notable changes. Use plain language — no markdown, no bullet points, just flowing prose.

Here is the data for the week of ${data.weekStart} to ${data.weekEnd}:

- Total registered users: ${data.totalUsers} (change from last week: ${data.totalUsersDiff > 0 ? "+" : ""}${data.totalUsersDiff})
- Total active users (last 7 days): ${data.totalActiveUsers}
- New signups this week: ${data.newSignups}
- New instances: ${data.newInstances}
- New projects added: ${data.newProjects.length}${data.newProjects.length > 0 ? ` (${data.newProjects.slice(0, 5).map(p => `${p.project} on ${p.instanceLabel}`).join(", ")}${data.newProjects.length > 5 ? ` and ${data.newProjects.length - 5} more` : ""})` : ""}
- Instances with version updates: ${data.instanceStats.filter(i => i.versionIsNew).map(i => i.label).join(", ") || "none"}
- Top instances by active users: ${data.instanceStats.sort((a, b) => b.activeUsers - a.activeUsers).slice(0, 3).map(i => `${i.label} (${i.activeUsers} active)`).join(", ")}
${data.changelogText ? `\nNew platform changes deployed this week:\n${data.changelogText}` : ""}
I already have tables for all the data, so just give me a high-level summary of the most important trends and changes this week. Remember to keep it concise and focused on the most notable insights.

Write the summary now:`;

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 300,
                messages: [{ role: "user", content: prompt }],
            }),
        });

        if (!response.ok) return "";
        const result = await response.json();
        return result.content?.[0]?.text ?? "";
    } catch {
        return "";
    }
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
            tracking_settings: {
                click_tracking: { enable: false },
                open_tracking: { enable: false },
            },
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`SendGrid error ${response.status}: ${err}`);
    }
}

router.post("/superadmin-email", async (c) => {
    const authError = await requireAdminOrInternal(c);
    if (authError) return authError;

    try {
        const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const weekStart = fmt(new Date(weekAgoMs));
        const weekEnd = fmt(new Date());

        const body = await c.req.json().catch(() => ({}));
        const requestedEmails: string[] | undefined = Array.isArray(body?.emails) ? body.emails : undefined;

        const [allUsers, servers] = await Promise.all([
            fetchAllUsers(),
            fetchServers(),
        ]);

        const adminEmails = requestedEmails ?? [...H_USERS];

        const recentSignups = allUsers
            .filter(u => u.created_at >= weekAgoMs && !H_USERS.has(getPrimaryEmail(u)))
            .sort((a, b) => b.created_at - a.created_at)
            .map(u => ({
                name: [u.first_name, u.last_name].filter(Boolean).join(" ") || "—",
                email: getPrimaryEmail(u),
                joinedDate: fmt(new Date(u.created_at)),
            }));

        const [logResults, state, pricing] = await Promise.all([
            Promise.all(servers.map(async (server: Server) => ({
                server,
                logs: await fetchServerUserLogs(server.id),
                projects: await fetchServerProjects(server.id),
                health: await fetchServerHealth(server.id),
                aiUsage: await fetchServerAiUsageLogs(server.id),
            }))),
            readEmailState(),
            fetchModelPricing(),
        ]);

        const knownIds = new Set(state?.knownInstanceIds ?? []);
        const newInstanceIds = new Set(servers.filter(s => !knownIds.has(s.id)).map(s => s.id));
        const knownVersions = state?.knownVersions ?? {};
        const knownUserCounts = state?.knownUserCounts ?? {};
        const knownProjects = state?.knownProjects ?? {};

        const allActiveUsers = new Set<string>();
        const instanceStats = logResults
            .filter(({ health }) => health.online)
            .map(({ server, logs, health, projects, aiUsage }) => {
                const recentLogs = logs.filter((l: UserLog) => new Date(l.timestamp).getTime() >= weekAgoMs && !H_USERS.has(l.user_email));
                const uniqueUsers = new Set(recentLogs.map((l: UserLog) => l.user_email));
                uniqueUsers.forEach((u: string) => allActiveUsers.add(u));
                const version = server.serverVersion || health.version;
                const versionIsNew = (server.id in knownVersions) && knownVersions[server.id] !== version && version !== "";
                const userCountDiff = (server.id in knownUserCounts) ? health.userCount - knownUserCounts[server.id] : 0;
                const aiCostUsd = computeAiCost(aiUsage, pricing);
                return { label: server.label, id: server.id, activeUsers: uniqueUsers.size, version, versionIsNew, projectCount: projects.length, userCount: health.userCount, userCountDiff, aiCostUsd };
            });

        const newProjects: { instanceLabel: string; project: string }[] = [];
        const currentProjects: Record<string, string[]> = {};
        const currentVersions: Record<string, string> = {};
        const currentUserCounts: Record<string, number> = {};
        for (const { server, projects, health } of logResults) {
            currentProjects[server.id] = projects;
            currentVersions[server.id] = server.serverVersion || health.version;
            currentUserCounts[server.id] = health.userCount;
            const previouslyKnown = new Set(knownProjects[server.id] ?? []);
            for (const project of projects) {
                if (!previouslyKnown.has(project)) {
                    newProjects.push({ instanceLabel: server.label, project });
                }
            }
        }

        const totalUsers = allUsers.filter(u => !H_USERS.has(getPrimaryEmail(u))).length;
        const totalUsersDiff = state?.knownTotalUsers !== undefined ? totalUsers - state.knownTotalUsers : 0;

        const updatedServersMinVersion = Object.entries(currentVersions)
            .filter(([id, ver]) => ver && knownVersions[id] && compareVersions(ver, knownVersions[id]) > 0)
            .map(([, ver]) => ver)
            .sort((a, b) => compareVersions(a, b))[0] ?? "";

        let changelogHtml = "";
        let changelogText = "";
        if (updatedServersMinVersion) {
            const sinceVersion = Object.values(knownVersions)
                .filter(v => !!v)
                .sort((a, b) => compareVersions(b, a))[0] ?? "";
            const adminChangelog = await fetchChangelogAuto();
            ({ html: changelogHtml, text: changelogText } = parseAutoChangelogSince(adminChangelog, "admin", sinceVersion));
        }

        const aiSummary = await generateAiSummary({
            weekStart, weekEnd,
            totalUsers, totalUsersDiff,
            totalActiveUsers: allActiveUsers.size,
            newSignups: recentSignups.length,
            newInstances: newInstanceIds.size,
            newProjects,
            instanceStats,
            changelogText,
        });

        const subject = `Weekly Analytics Report · ${weekStart} – ${weekEnd}`;
        const html = buildSuperAdminEmailHtml(weekStart, weekEnd, totalUsers, totalUsersDiff, allActiveUsers.size, instanceStats, recentSignups, newInstanceIds, newProjects, aiSummary, changelogHtml);

        await sendEmail(adminEmails, subject, html);
        await writeEmailState({ lastSentAt: Date.now(), knownInstanceIds: servers.map(s => s.id), knownProjects: currentProjects, knownVersions: currentVersions, knownUserCounts: currentUserCounts, knownTotalUsers: totalUsers });

        return c.json({ success: true, sentTo: adminEmails.length });
    } catch (error) {
        console.error("Failed to send weekly report:", error);
        return c.json({ error: String(error) }, 500);
    }
});

router.post("/instance-admin-emails", async (c) => {
    const authError = await requireAdminOrInternal(c);
    if (authError) return authError;

    try {
        const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        const weekStart = fmt(new Date(weekAgoMs));
        const weekEnd = fmt(new Date());

        const body = await c.req.json().catch(() => ({}));
        const requestedServerIds: string[] | undefined = Array.isArray(body?.serverIds) ? body.serverIds : undefined;

        const [allServers, state] = await Promise.all([
            fetchServers(),
            readInstanceAdminEmailState(),
        ]);

        const servers = requestedServerIds
            ? allServers.filter((s: Server) => requestedServerIds.includes(s.id))
            : allServers;

        const knownUserCounts = state?.knownUserCounts ?? {};
        const knownProjects = state?.knownProjects ?? {};
        const knownVersions = state?.knownVersions ?? {};

        const [results, pricing] = await Promise.all([
            Promise.all(servers.map(async (server: Server) => ({
                server,
                logs: await fetchServerUserLogs(server.id),
                projects: await fetchServerProjects(server.id),
                health: await fetchServerHealth(server.id),
                aiUsage: await fetchServerAiUsageLogs(server.id),
            }))),
            fetchModelPricing(),
        ]);

        let emailsSent = 0;
        const subject = (label: string) => `${label} Weekly Report · ${weekStart} – ${weekEnd}`;

        const testOverrideEmail = "nicholaswillmottvball@gmail.com";

        const newKnownProjects: Record<string, string[]> = {};
        const newKnownUserCounts: Record<string, number> = {};
        const newKnownVersions: Record<string, string> = {};

        for (const { server, logs, projects, health, aiUsage } of results) {
            const version = server.serverVersion || health.version;
            newKnownProjects[server.id] = projects;
            newKnownUserCounts[server.id] = health.userCount;
            newKnownVersions[server.id] = version;

            if (!health.online || health.adminUsers.length === 0) continue;

            const recentLogs = logs.filter((l: UserLog) => new Date(l.timestamp).getTime() >= weekAgoMs);
            const activeUsers = new Set(recentLogs.map((l: UserLog) => l.user_email)).size;
            const userCountDiff = (server.id in knownUserCounts) ? health.userCount - knownUserCounts[server.id] : 0;
            const aiCostUsd = computeAiCost(aiUsage, pricing);

            const userRequestCounts = new Map<string, number>();
            for (const log of recentLogs) {
                userRequestCounts.set(log.user_email, (userRequestCounts.get(log.user_email) ?? 0) + 1);
            }
            const topUsers = [...userRequestCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

            const previouslyKnown = new Set(knownProjects[server.id] ?? []);
            const newProjects = projects.filter(p => !previouslyKnown.has(p));

            const projectActivityCounts = new Map<string, number>();
            for (const log of recentLogs) {
                if (log.project_id) {
                    projectActivityCounts.set(log.project_id, (projectActivityCounts.get(log.project_id) ?? 0) + 1);
                }
            }
            const projectsSortedByActivity = projects
                .map(p => ({ name: p, requests: projectActivityCounts.get(p) ?? 0, isNew: !previouslyKnown.has(p) }))
                .sort((a, b) => b.requests - a.requests);

            const lastKnownVersion = knownVersions[server.id] ?? "";
            let changelogHtml = "";
            let changelogText = "";
            if (lastKnownVersion && version && compareVersions(version, lastKnownVersion) > 0) {
                const changelog = await fetchChangelogAuto();
                ({ html: changelogHtml, text: changelogText } = parseAutoChangelogSince(changelog, "user", lastKnownVersion));
            }

            const aiSummary = await generateInstanceAiSummary({
                weekStart, weekEnd,
                instanceLabel: server.label,
                version,
                userCount: health.userCount,
                userCountDiff,
                activeUsers,
                newProjects,
                changelogText,
                aiCostUsd,
            });

            const html = buildInstanceAdminEmailHtml(
                weekStart, weekEnd,
                server.label, server.id,
                version, health.userCount, userCountDiff,
                activeUsers, projectsSortedByActivity, recentLogs,
                changelogHtml, aiSummary, aiCostUsd, topUsers
            );

            await sendEmail([testOverrideEmail], subject(server.label), html);
            emailsSent += 1;
        }

        await writeInstanceAdminEmailState({ knownProjects: newKnownProjects, knownUserCounts: newKnownUserCounts, knownVersions: newKnownVersions });

        return c.json({ success: true, emailsSent });
    } catch (error) {
        console.error("Failed to send instance admin emails:", error);
        return c.json({ error: String(error) }, 500);
    }
});

export default router;