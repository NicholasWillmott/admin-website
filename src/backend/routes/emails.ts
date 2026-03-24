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

function buildActivityChartUrl(logResults: { server: Server; logs: UserLog[] }[], clerkEmailSet: Set<string>): string {
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
        return {
            label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
        };
    });

    const uniquePerDay: Set<string>[] = Array.from({ length: 7 }, () => new Set());
    for (const { logs } of logResults) {
        for (const log of logs) {
            if (log.endpoint !== "getInstanceDetail" || !clerkEmailSet.has(log.user_email)) continue;
            const d = new Date(log.timestamp);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            const idx = days.findIndex(day => day.key === key);
            if (idx !== -1) uniquePerDay[idx].add(log.user_email);
        }
    }

    const labels = days.map(d => d.label);
    const counts = days.map((_, i) => uniquePerDay[i].size);

    const config = {
        type: "line",
        data: {
            labels,
            datasets: [{
                data: counts,
                borderColor: "#0e706c",
                backgroundColor: "rgba(14,112,108,0.08)",
                borderWidth: 2,
                pointBackgroundColor: "#0e706c",
                pointRadius: 4,
                fill: true,
                tension: 0.3,
            }],
        },
        options: {
            legend: { display: false },
            scales: {
                xAxes: [{ gridLines: { display: false }, ticks: { fontColor: "#a1a1a1", fontSize: 11 } }],
                yAxes: [{ gridLines: { color: "#e8e8e8" }, ticks: { fontColor: "#a1a1a1", fontSize: 11, precision: 0, beginAtZero: true } }],
            },
        },
    };

    const encoded = encodeURIComponent(JSON.stringify(config));
    return `https://quickchart.io/chart?c=${encoded}&w=540&h=180&bkg=white`;
}

function buildEmailHtml(
    weekStart: string,
    weekEnd: string,
    totalActiveUsers: number,
    instanceStats: { label: string; id: string; activeUsers: number }[],
    recentSignups: { name: string; email: string; joinedDate: string }[],
    activityChartUrl: string
): string {
    const instanceRows = instanceStats
        .sort((a, b) => b.activeUsers - a.activeUsers)
        .map(inst => `
            <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #cacaca;color:#2a2a2a;">${inst.label}</td>
                <td style="padding:10px 16px;border-bottom:1px solid #cacaca;color:#a1a1a1;font-size:13px;">${inst.id}</td>
                <td style="padding:10px 16px;border-bottom:1px solid #cacaca;text-align:center;font-weight:700;color:#0e706c;">${inst.activeUsers}</td>
            </tr>`)
        .join("");

    const signupRows = recentSignups.length > 0
        ? recentSignups.map(u => `
            <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #cacaca;color:#2a2a2a;">${u.name}</td>
                <td style="padding:10px 16px;border-bottom:1px solid #cacaca;color:#a1a1a1;font-size:13px;">${u.email}</td>
                <td style="padding:10px 16px;border-bottom:1px solid #cacaca;color:#a1a1a1;font-size:13px;">${u.joinedDate}</td>
            </tr>`).join("")
        : `<tr><td colspan="3" style="padding:16px;text-align:center;color:#a1a1a1;">No new signups this week</td></tr>`;

    return `<!DOCTYPE html>
<html>
<body style="font-family:Inter,system-ui,-apple-system,sans-serif;background:#f2f2f2;margin:0;padding:32px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #cacaca;">
    <div style="background:#0e706c;padding:28px 32px;">
      <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">Weekly Analytics Report</h1>
      <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:14px;">${weekStart} – ${weekEnd}</p>
    </div>
    <div style="padding:28px 32px;">
      <div style="background:#f2f2f2;border-radius:4px;padding:20px 24px;margin-bottom:28px;border:1px solid #cacaca;">
        <div style="font-size:11px;color:#2a2a2a;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Total Active Users (7 days)</div>
        <div style="font-size:40px;font-weight:700;color:#0e706c;margin-top:4px;">${totalActiveUsers}</div>
      </div>
      <h2 style="font-size:13px;font-weight:700;color:#2a2a2a;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.06em;">User Sign-in Activity</h2>
      <p style="font-size:12px;color:#a1a1a1;margin:0 0 10px;">Unique active users per day</p>
      <div style="border:1px solid #cacaca;border-radius:4px;overflow:hidden;margin-bottom:32px;">
        <img src="${activityChartUrl}" width="540" style="display:block;width:100%;max-width:540px;" alt="User sign-in activity chart"/>
      </div>
      <h2 style="font-size:13px;font-weight:700;color:#2a2a2a;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.06em;">Active Users by Instance</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#2a2a2a;margin-bottom:32px;border:1px solid #cacaca;border-radius:4px;">
        <thead>
          <tr style="background:#f2f2f2;">
            <th style="padding:10px 16px;text-align:left;font-weight:700;color:#2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #cacaca;">Instance</th>
            <th style="padding:10px 16px;text-align:left;font-weight:700;color:#2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #cacaca;">ID</th>
            <th style="padding:10px 16px;text-align:center;font-weight:700;color:#2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #cacaca;">Active Users</th>
          </tr>
        </thead>
        <tbody>
          ${instanceRows}
        </tbody>
      </table>
      <h2 style="font-size:13px;font-weight:700;color:#2a2a2a;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.06em;">New Signups (${recentSignups.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#2a2a2a;border:1px solid #cacaca;border-radius:4px;">
        <thead>
          <tr style="background:#f2f2f2;">
            <th style="padding:10px 16px;text-align:left;font-weight:700;color:#2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #cacaca;">Name</th>
            <th style="padding:10px 16px;text-align:left;font-weight:700;color:#2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #cacaca;">Email</th>
            <th style="padding:10px 16px;text-align:left;font-weight:700;color:#2a2a2a;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #cacaca;">Joined</th>
          </tr>
        </thead>
        <tbody>
          ${signupRows}
        </tbody>
      </table>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #cacaca;text-align:center;">
      <p style="margin:0;font-size:12px;color:#a1a1a1;">Fastr Analytics Admin · Automated weekly report</p>
    </div>
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

        const logResults = await Promise.all(
            servers.map(async (server: Server) => ({
                server,
                logs: await fetchServerUserLogs(server.id),
            }))
        );

        const allActiveUsers = new Set<string>();
        const instanceStats = logResults.map(({ server, logs }: { server: Server; logs: UserLog[] }) => {
            const recentLogs = logs.filter((l: UserLog) => new Date(l.timestamp).getTime() >= weekAgoMs);
            const uniqueUsers = new Set(recentLogs.map((l: UserLog) => l.user_email));
            uniqueUsers.forEach((u: string) => allActiveUsers.add(u));
            return { label: server.label, id: server.id, activeUsers: uniqueUsers.size };
        });

        const clerkEmailSet = new Set(allUsers.map(u => getPrimaryEmail(u)));
        const activityChartUrl = buildActivityChartUrl(logResults, clerkEmailSet);
        console.log("Chart URL:", activityChartUrl);
        const subject = `Weekly Analytics Report · ${weekStart} – ${weekEnd}`;
        const html = buildEmailHtml(weekStart, weekEnd, allActiveUsers.size, instanceStats, recentSignups, activityChartUrl);

        await sendEmail(adminEmails, subject, html);

        return c.json({ success: true, sentTo: adminEmails.length });
    } catch (error) {
        console.error("Failed to send weekly report:", error);
        return c.json({ error: String(error) }, 500);
    }
});

export default router;