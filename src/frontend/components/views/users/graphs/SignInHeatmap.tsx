import { createSignal, For } from 'solid-js';
import type { ClerkUser, UserLog, ServerUserLogs } from '../../../../types.ts';

interface SignInHeatmapProps {
    users: ClerkUser[];
    userLogs: ServerUserLogs | undefined;
    selectedInstance: string | null;
}

type TooltipState = { x: number; y: number; text: string };

const DAYS = ['Sun', 'Mon', 'Tues', 'Wed', 'Thur', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const W = 680;
const H = 180;
const PAD = { top: 14, right: 16, bottom: 28, left: 50 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top - PAD.bottom;

const CELL_W = IW / 24;
const CELL_H = IH / 7;

function buildGridFromLogs(logs: UserLog[], emailSet: Set<string>): number[][] {
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const log of logs) {
        if (!emailSet.has(log.user_email)) continue;
        if (log.endpoint !== 'getInstanceDetail') continue;
        const ts = new Date(log.timestamp).getTime();
        if (ts < oneWeekAgo) continue;
        const d = new Date(log.timestamp);
        grid[d.getDay()][d.getHours()]++;
    }
    return grid;
}

function cellColor(count: number, max: number): string {
    if (count === 0 || max === 0) return 'rgba(255,255,255,0.06)';
    const t = count / max;
    const r = Math.round(14 + t * 30);
    const g = Math.round(112 + t * 30);
    const b = Math.round(108 + t * 20);
    return `rgb(${r},${g},${b})`;
}

function formatHour(h: number): string {
    if (h === 0) return '12am';
    if (h < 12) return `${h}am`;
    if (h === 12) return '12pm';
    return `${h - 12}pm`;
}

function renderTooltip(t: TooltipState) {
    const tw = Math.max(t.text.length * 6.5 + 16, 50);
    const th = 20;
    const tx = Math.min(Math.max(t.x - tw / 2, PAD.left), W - PAD.right - tw);
    const ty = Math.max(t.y - th - 10, 4);
    return (
        <g style={{ "pointer-events": "none" }}>
            <rect x={tx} y={ty} width={tw} height={th} rx="4" fill="#1a2e22" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
            <text x={tx + tw / 2} y={ty + 13} text-anchor="middle" font-size="10" font-weight="500" fill="#e2e8f0">
                {t.text}
            </text>
        </g>
    );
}

export function SignInHeatmap(p: SignInHeatmapProps) {
    const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);

    const emailSet = () => new Set(
        p.users.map(u => u.email_addresses.find(e => e.id === u.primary_email_address_id)?.email_address ?? '')
    );

    const relevantLogs = () => {
        const logs = p.userLogs;
        if (!logs) return [];
        const serverIds = p.selectedInstance ? [p.selectedInstance] : Object.keys(logs);
        const result: UserLog[] = [];
        for (const id of serverIds) result.push(...(logs[id] ?? []));
        return result;
    };

    const grid = () => buildGridFromLogs(relevantLogs(), emailSet());

    const max = () => {
        let m = 0;
        for (const row of grid()) for (const c of row) if (c > m) m = c;
        return m;
    };

    const totalSessions = () => {
        let total = 0;
        for (const row of grid()) for (const c of row) total += c;
        return total;
    };

    return (
        <div class="activity-graph-section">
            <div class="activity-graph-header">
                <div>
                    <span class="activity-graph-title">Sign-in Heatmap</span>
                    <span class="activity-graph-subtitle">
                        ({totalSessions()} active session{totalSessions() !== 1 ? 's' : ''} in the last 7 days)
                    </span>
                </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} width="100%" class="activity-graph-svg">
                <For each={DAYS}>
                    {(day, i) => (
                        <text
                            x={PAD.left - 6}
                            y={PAD.top + i() * CELL_H + CELL_H / 2 + 3}
                            text-anchor="end"
                            font-size="10"
                            font-weight="500"
                            fill="#94a3b8"
                        >{day}</text>
                    )}
                </For>

                <For each={HOURS}>
                    {(h) => (
                        h % 3 === 0 ? (
                            <text
                                x={PAD.left + h * CELL_W + CELL_W / 2}
                                y={H - PAD.bottom + 14}
                                text-anchor="middle"
                                font-size="9"
                                fill="#94a3b8"
                            >{formatHour(h)}</text>
                        ) : null
                    )}
                </For>

                <For each={DAYS}>
                    {(_day, dayIdx) => (
                        <For each={HOURS}>
                            {(hour) => {
                                const count = () => grid()[dayIdx()][hour];
                                const x = PAD.left + hour * CELL_W;
                                const y = PAD.top + dayIdx() * CELL_H;
                                return (
                                    <rect
                                        x={x + 0.5}
                                        y={y + 0.5}
                                        width={CELL_W - 1}
                                        height={CELL_H - 1}
                                        rx="2"
                                        fill={cellColor(count(), max())}
                                        style={{ cursor: 'default' }}
                                        onMouseEnter={() => setTooltip({
                                            x: x + CELL_W / 2,
                                            y,
                                            text: `${DAYS[dayIdx()]} ${formatHour(hour)}: ${count()} session${count() !== 1 ? 's' : ''}`,
                                        })}
                                        onMouseLeave={() => setTooltip(null)}
                                    />
                                );
                            }}
                        </For>
                    )}
                </For>

                {tooltip() && renderTooltip(tooltip()!)}
            </svg>
        </div>
    );
}
