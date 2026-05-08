import { createMemo, For } from 'solid-js';
import type { Server, ServerUserLogs } from '../../types.ts';

interface CountryActivityModalProps {
    servers: Server[] | undefined;
    userLogs: ServerUserLogs | undefined;
    hUsers: string[];
    onClose: () => void;
}

const TARGET_KEYWORDS = ['Burkina', 'Congo', 'Liberia', 'Nigeria', 'Sierra', 'Zambia', 'Ghana'];

function isTargetServer(label: string): boolean {
    return TARGET_KEYWORDS.some(k => label.toLowerCase().includes(k.toLowerCase()));
}

const FROM = new Date('2026-02-12T00:00:00');
const TO = new Date();
TO.setHours(23, 59, 59, 999);

function buildDateRange(): string[] {
    const dates: string[] = [];
    const cur = new Date(FROM);
    while (cur <= TO) {
        dates.push(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
    }
    return dates;
}

const ALL_DATES = buildDateRange();
const FROM_MS = FROM.getTime();
const TO_MS = TO.getTime();

function buildDailyData(serverId: string, userLogs: ServerUserLogs, hUserSet: Set<string>): number[] {
    const logs = userLogs[serverId] ?? [];
    const uniquePerDay = new Map<string, Set<string>>();
    for (const date of ALL_DATES) uniquePerDay.set(date, new Set());

    for (const log of logs) {
        if (log.endpoint !== 'getCurrentUser') continue;
        if (hUserSet.has(log.user_email)) continue;
        const ts = new Date(log.timestamp).getTime();
        if (ts < FROM_MS || ts > TO_MS) continue;
        const day = log.timestamp.split('T')[0];
        if (uniquePerDay.has(day)) uniquePerDay.get(day)!.add(log.user_email);
    }

    return ALL_DATES.map(d => uniquePerDay.get(d)!.size);
}

const W = 660;
const H = 90;
const PAD = { top: 12, right: 12, bottom: 24, left: 28 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top - PAD.bottom;
const BASELINE = H - PAD.bottom;

function xPos(i: number): number {
    return ALL_DATES.length > 1
        ? PAD.left + (i / (ALL_DATES.length - 1)) * IW
        : PAD.left + IW / 2;
}

function buildXLabels(): { x: number; label: string }[] {
    const labels: { x: number; label: string }[] = [];
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let lastMonth = -1;
    ALL_DATES.forEach((date, i) => {
        const d = new Date(date);
        const m = d.getMonth();
        if (m !== lastMonth) {
            labels.push({ x: xPos(i), label: MONTH_NAMES[m] });
            lastMonth = m;
        } else if (d.getDate() === 15) {
            labels.push({ x: xPos(i), label: '15' });
        }
    });
    return labels;
}

const X_LABELS = buildXLabels();

interface ServerChartProps {
    server: Server;
    counts: number[];
}

function ServerChart(p: ServerChartProps) {
    const max = Math.max(...p.counts, 1);
    const total = p.counts.reduce((a, b) => a + b, 0);
    const peak = Math.max(...p.counts);

    const pts = p.counts.map((count, i) => ({
        x: xPos(i),
        y: PAD.top + IH - (count / max) * IH,
        count,
    }));

    const linePath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    const first = pts[0];
    const last = pts[pts.length - 1];
    const areaPath = `${linePath} L${last.x.toFixed(1)},${BASELINE} L${first.x.toFixed(1)},${BASELINE} Z`;

    const mid = Math.ceil(max / 2);
    const yTicks = [
        { value: 0, y: BASELINE },
        { value: mid, y: PAD.top + IH - (mid / max) * IH },
        { value: max, y: PAD.top },
    ];

    return (
        <div style="border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px 16px; background: rgba(255,255,255,0.02)">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px">
                <span style="font-weight: 600; color: #fff; font-size: 14px">{p.server.label}</span>
                <span style="color: #888; font-size: 12px">
                    peak {peak} · {total} total sign-ins
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style="display: block">
                <For each={yTicks}>
                    {(tick) => (
                        <g>
                            <line
                                x1={PAD.left} y1={tick.y}
                                x2={W - PAD.right} y2={tick.y}
                                stroke="rgba(255,255,255,0.06)" stroke-width="1"
                            />
                            <text
                                x={PAD.left - 4} y={tick.y + 4}
                                text-anchor="end" font-size="9" fill="#667"
                            >{tick.value}</text>
                        </g>
                    )}
                </For>

                <path d={areaPath} fill="#0e706c" fill-opacity="0.10" />
                <path d={linePath} fill="none" stroke="#0e706c" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />

                <For each={X_LABELS}>
                    {(lbl) => (
                        <text
                            x={lbl.x} y={H - PAD.bottom + 14}
                            text-anchor="middle" font-size="9" fill="#667"
                        >{lbl.label}</text>
                    )}
                </For>
            </svg>
        </div>
    );
}

export function CountryActivityModal(p: CountryActivityModalProps) {
    const hUserSet = createMemo(() => new Set(p.hUsers));

    const targetServers = createMemo(() =>
        (p.servers ?? []).filter(s => isTargetServer(s.label))
    );

    const chartsData = createMemo(() =>
        targetServers().map(server => ({
            server,
            counts: p.userLogs ? buildDailyData(server.id, p.userLogs, hUserSet()) : [],
        }))
    );

    const fromLabel = FROM.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const toLabel = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div
                class="modal-content"
                onClick={(e) => e.stopPropagation()}
                style="max-width: 760px; max-height: 88vh; overflow-y: auto"
            >
                <div class="modal-header">
                    <div>
                        <h2 style="margin: 0">Daily Activity by Country</h2>
                        <p style="color: #888; font-size: 13px; margin: 2px 0 0">
                            Unique sign-ins per day · {fromLabel} – {toLabel}
                        </p>
                    </div>
                    <button class="modal-close" onClick={p.onClose}>✕</button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; flex-direction: column; gap: 16px">
                        <For each={chartsData()}>
                            {({ server, counts }) => (
                                <ServerChart server={server} counts={counts} />
                            )}
                        </For>
                        {targetServers().length === 0 && (
                            <p style="color: #666; font-size: 13px">No matching country servers found.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
