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
    email_addresses: { id: string; email_address: string }[];
    primary_email_address_id: string | null;
    public_metadata: Record<string, unknown>;
}

async function fetchAdminEmails(): Promise<string[]> {
    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const response = await fetch("https://api.clerk.com/v1/users?limit=500", {
        headers: { Authorization: `Bearer ${clerkSecretKey}` },
    });
    const users: ClerkUser[] = await response.json();

    return users
        .filter(u => u.public_metadata?.isAdmin === true)
        .map(u => {
            const primary = u.email_addresses.find(e => e.id === u.primary_email_address_id);
            return primary?.email_address ?? u.email_addresses[0]?.email_address;
        })
        .filter(Boolean) as string[];
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

function buildEmailHtml(
    weekStart: string,
    weekEnd: string,
    totalActiveUsers: number,
    instanceStats: { label: string; id: string; activeUsers: number }[]
): string {
    const instanceRows = instanceStats
        .sort((a, b) => b.activeUsers - a.activeUsers)
        .map(inst => `
            <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;">${inst.label}</td>
                <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${inst.id}</td>
                <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600;">${inst.activeUsers}</td>
            </tr>`)
        .join("");

    return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:32px;">
  <div style="max-width:640px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="background:#1d4ed8;padding:28px 32px;">
      <h1 style="color:white;margin:0;font-size:20px;font-weight:600;">Weekly Analytics Report</h1>
      <p style="color:#bfdbfe;margin:4px 0 0;font-size:14px;">${weekStart} – ${weekEnd}</p>
    </div>
    <div style="padding:28px 32px;">
      <div style="background:#eff6ff;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Total Active Users (7 days)</div>
        <div style="font-size:40px;font-weight:700;color:#1d4ed8;margin-top:4px;">${totalActiveUsers}</div>
      </div>
      <h2 style="font-size:15px;font-weight:600;color:#111827;margin:0 0 12px;">Active Users by Instance</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 16px;text-align:left;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Instance</th>
            <th style="padding:10px 16px;text-align:left;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">ID</th>
            <th style="padding:10px 16px;text-align:center;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Active Users</th>
          </tr>
        </thead>
        <tbody>
          ${instanceRows}
        </tbody>
      </table>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">Fastr Analytics Admin · Automated weekly report</p>
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

        const [_, servers] = await Promise.all([
            fetchAdminEmails(),
            fetchServers(),
        ]);

        const adminEmails = ["nick@usefuldata.com.au"];

        const logResults = await Promise.all(
            servers.map(async server => ({
                server,
                logs: await fetchServerUserLogs(server.id),
            }))
        );

        const allActiveUsers = new Set<string>();
        const instanceStats = logResults.map(({ server, logs }) => {
            const recentLogs = logs.filter(l => new Date(l.timestamp).getTime() >= weekAgoMs);
            const uniqueUsers = new Set(recentLogs.map(l => l.user_email));
            uniqueUsers.forEach(u => allActiveUsers.add(u));
            return { label: server.label, id: server.id, activeUsers: uniqueUsers.size };
        });

        const subject = `Weekly Analytics Report · ${weekStart} – ${weekEnd}`;
        const html = buildEmailHtml(weekStart, weekEnd, allActiveUsers.size, instanceStats);

        await sendEmail(adminEmails, subject, html);

        return c.json({ success: true, sentTo: adminEmails.length });
    } catch (error) {
        console.error("Failed to send weekly report:", error);
        return c.json({ error: String(error) }, 500);
    }
});

export default router;