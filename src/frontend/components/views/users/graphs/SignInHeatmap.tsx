import { createSignal, createEffect, on, For } from 'solid-js';
import type { ClerkUser, ClerkSession } from '../../../../types.ts';

interface SignInHeatmapProps {
    users: ClerkUser[] | undefined;
    allUsers: ClerkUser[] | undefined;
    onFetchSessions: (userId: string, since?: number) => Promise<ClerkSession[]>;
}

type TooltipState = { x: number; y: number; text: string };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const W = 680;
const H = 180;
const PAD = { top: 14, right: 16, bottom: 28, left: 50 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top - PAD.bottom;

const CELL_W = IW / 24;
const CELL_H = IH / 7;

function buildGridFromSessions(sessions: ClerkSession[]) {
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const s of sessions) {
        const d = new Date(s.created_at);
        grid[d.getDay()][d.getHours()]++;
    }
    return grid;
}

function cellColor(count: number, max: number): string {
    if (count === 0 || max === 0) return '#f0f0f0';
    const t = count / max;
    // Interpolate from light teal to dark teal
    const r = Math.round(230 - t * 216);
    const g = Math.round(240 - t * 128);
    const b = Math.round(238 - t * 130);
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
            <rect x={tx} y={ty} width={tw} height={th} rx="4" fill="white" stroke="#ddd" stroke-width="1" />
            <text x={tx + tw / 2} y={ty + 13} text-anchor="middle" font-size="10" font-weight="500" fill="#333">
                {t.text}
            </text>
        </g>
    );
}

export function SignInHeatmap(p: SignInHeatmapProps) {
    const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);
    const [sessionsByUser, setSessionsByUser] = createSignal<Map<string, ClerkSession[]>>(new Map());
    const [loading, setLoading] = createSignal(false);
    const [progress, setProgress] = createSignal({ done: 0, total: 0 });

    // Fetch sessions when allUsers becomes available
    let hasFetched = false;
    createEffect(on(() => p.allUsers, async (users) => {
        if (!users || users.length === 0 || hasFetched) return;
        hasFetched = true;

        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recentUsers = users.filter(u => u.last_sign_in_at && u.last_sign_in_at >= oneWeekAgo);

        if (recentUsers.length === 0) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setProgress({ done: 0, total: recentUsers.length });

        const sessMap = new Map<string, ClerkSession[]>();
        const BATCH_SIZE = 10;
        for (let i = 0; i < recentUsers.length; i += BATCH_SIZE) {
            const batch = recentUsers.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(u => p.onFetchSessions(u.id, oneWeekAgo)));
            batch.forEach((u, idx) => {
                if (results[idx].length > 0) {
                    sessMap.set(u.id, results[idx]);
                }
            });
            setProgress({ done: Math.min(i + BATCH_SIZE, recentUsers.length), total: recentUsers.length });
            setSessionsByUser(new Map(sessMap));
        }

        setLoading(false);
    }));

    // Reactively filter sessions based on current users prop
    const filteredSessions = () => {
        const users = p.users;
        if (!users) return [];
        const map = sessionsByUser();
        const userIds = new Set(users.map(u => u.id));
        const sessions: ClerkSession[] = [];
        for (const [userId, userSessions] of map) {
            if (userIds.has(userId)) {
                sessions.push(...userSessions);
            }
        }
        return sessions;
    };

    const grid = () => buildGridFromSessions(filteredSessions());

    const max = () => {
        let m = 0;
        for (const row of grid()) {
            for (const c of row) {
                if (c > m) m = c;
            }
        }
        return m;
    };

    const totalSessions = () => filteredSessions().length;

    return (
        <div class="activity-graph-section">
            <div class="activity-graph-header">
                <div>
                    <span class="activity-graph-title">Sign-in Heatmap</span>
                    <span class="activity-graph-subtitle">
                        ({totalSessions()} sign-in{totalSessions() !== 1 ? 's' : ''} in the last 7 days)
                    </span>
                </div>
                {loading() && (
                    <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                        <div class="spinner spinner-sm"></div>
                        <span style={{ color: 'rgba(255,255,255,0.6)', 'font-size': '12px' }}>
                            Loading sessions {progress().done}/{progress().total}
                        </span>
                    </div>
                )}
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} width="100%" class="activity-graph-svg">
                {/* Day labels */}
                <For each={DAYS}>
                    {(day, i) => (
                        <text
                            x={PAD.left - 6}
                            y={PAD.top + i() * CELL_H + CELL_H / 2 + 3}
                            text-anchor="end"
                            font-size="10"
                            font-weight="500"
                            fill="#999"
                        >{day}</text>
                    )}
                </For>

                {/* Hour labels */}
                <For each={HOURS}>
                    {(h) => (
                        h % 3 === 0 ? (
                            <text
                                x={PAD.left + h * CELL_W + CELL_W / 2}
                                y={H - PAD.bottom + 14}
                                text-anchor="middle"
                                font-size="9"
                                fill="#bbb"
                            >{formatHour(h)}</text>
                        ) : null
                    )}
                </For>

                {/* Cells */}
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
                                            text: `${DAYS[dayIdx()]} ${formatHour(hour)}: ${count()} sign-in${count() !== 1 ? 's' : ''}`,
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
