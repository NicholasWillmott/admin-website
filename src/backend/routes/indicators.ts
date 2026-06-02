import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import { isSafeParam } from "../lib/utils.ts";
import ExcelJS from "exceljs";

const router = new Hono();

interface Server {
    id: string;
    label: string;
}

interface IndicatorRow {
    id: string;
    label: string;
    mappedTo: string | null;
}

async function fetchServers(): Promise<Server[]> {
    const response = await fetch("https://central.fastr-analytics.org/servers.json");
    return response.json();
}

function sanitizeSheetName(name: string): string {
    return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
}

const NAVY = { argb: "FF1F3864" };
const WHITE = { argb: "FFFFFFFF" };
const GRAY = { argb: "FF94A3B8" };
const ROW_BORDER = { bottom: { style: "thin" as const, color: { argb: "FFE2E8F0" } } };

router.post("/indicators/export", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    let ids: string[] | undefined;
    try {
        const body = await c.req.json<{ ids?: string[] }>();
        ids = body.ids;
    } catch {
        ids = undefined;
    }

    let servers = await fetchServers();
    if (ids && ids.length > 0) {
        if (!ids.every(isSafeParam)) {
            return c.json({ error: "Invalid server ID" }, 400);
        }
        servers = servers.filter((s) => ids!.includes(s.id));
    }

    const results = await Promise.allSettled(
        servers.map(async (server) => {
            const response = await fetch(
                `https://${server.id}.fastr-analytics.org/dhis2-indicators-export`,
            );
            const data = await response.json();
            return { server, indicators: data.indicators as IndicatorRow[] };
        }),
    );

    const wb = new ExcelJS.Workbook();

    for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { server, indicators } = result.value;

        const ws = wb.addWorksheet(sanitizeSheetName(server.label));

        ws.columns = [
            { key: "num", width: 6 },
            { key: "indicatorId", width: 22 },
            { key: "indicatorLabel", width: 55 },
            { key: "dhis2Id", width: 22 },
        ];

        // Row 1: title
        ws.mergeCells("A1:D1");
        const titleCell = ws.getCell("A1");
        titleCell.value = server.label;
        titleCell.font = { bold: true, size: 13, color: WHITE };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: NAVY };
        titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(1).height = 28;

        // Row 2: subtitle
        ws.mergeCells("A2:D2");
        const subtitleCell = ws.getCell("A2");
        const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
        subtitleCell.value = `As of ${dateStr} — ${indicators.length} indicator${indicators.length !== 1 ? "s" : ""}`;
        subtitleCell.font = { italic: true, size: 10, color: GRAY };
        subtitleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        ws.getRow(2).height = 18;

        // Row 3: spacer
        ws.getRow(3).height = 6;

        // Row 4: column headers
        const headerRow = ws.getRow(4);
        headerRow.values = ["#", "Indicator ID", "Indicator label", "DHIS2 ID"];
        headerRow.height = 20;
        headerRow.eachCell({ includeEmpty: true }, (cell) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: NAVY };
            cell.font = { bold: true, color: WHITE, size: 11 };
            cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        });

        // Data rows
        indicators.forEach((ind, i) => {
            const row = ws.getRow(5 + i);
            row.values = [i + 1, ind.mappedTo ?? "", ind.label, ind.id];
            row.height = 16;
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.border = ROW_BORDER;
            });
        });
    }

    const buffer = await wb.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    return new Response(buffer as unknown as ArrayBuffer, {
        headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="indicators-${date}.xlsx"`,
        },
    });
});

export default router;
