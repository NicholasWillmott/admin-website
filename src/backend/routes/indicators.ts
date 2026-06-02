/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import { isSafeParam } from "../lib/utils.ts";

const router = new Hono();

interface Server {
    id: string;
    label: string;
}

async function fetchServers(): Promise<Server[]> {
    const response = await fetch("https://central.fastr-analytics.org/servers.json");
    return response.json();
}

function csvEscape(value: string): string {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

router.post("/indicators/export", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ ids?: string[] }>().catch(() => ({}));

    let servers = await fetchServers();
    if (body.ids && body.ids.length > 0) {
        if (!body.ids.every(isSafeParam)) {
            return c.json({ error: "Invalid server ID" }, 400);
        }
        servers = servers.filter((s) => body.ids!.includes(s.id));
    }

    interface IndicatorRow {
        id: string;
        label: string;
        mappedTo: string | null;
    }

    const results = await Promise.allSettled(
        servers.map(async (server) => {
            const response = await fetch(
                `https://${server.id}.fastr-analytics.org/indicators`,
            );
            const data = await response.json();
            return { server, indicators: data.indicators as IndicatorRow[] };
        }),
    );

    const rows: string[] = ["Server,DHIS2 ID,Label,Mapped To"];
    for (const result of results) {
        if (result.status === "fulfilled") {
            const { server, indicators } = result.value;
            for (const ind of indicators) {
                rows.push(
                    `${csvEscape(server.label)},${csvEscape(ind.id)},${csvEscape(ind.label)},${csvEscape(ind.mappedTo ?? "")}`,
                );
            }
        }
    }

    const csv = rows.join("\n");
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
        headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="indicators-${date}.csv"`,
        },
    });
});

export default router;
