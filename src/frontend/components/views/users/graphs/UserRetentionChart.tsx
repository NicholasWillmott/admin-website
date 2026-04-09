import { createSignal, For } from 'solid-js';
import type { ClerkUser } from '../../../../types.ts';

type TooltipState = { x: number; y: number; text: string };

interface UserRetentionChartProps {
    users: ClerkUser[] | undefined;
}

const W = 680;
const H = 210;
const PAD = { top: 14, right: 120, bottom: 14, left: 90 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top - PAD.bottom;

const BUCKETS = [
    { label: 'Today',     color: '#0e706c',   ms: 24 * 60 * 60 * 1000 },
    { label: 'Last 7d',   color: '#1a8f89',   ms: 7 * 24 * 60 * 60 * 1000 },
    { label: 'Last 30d',  color: '#2aada6',   ms: 30 * 24 * 60 * 60 * 1000 },
    { label: 'Last 90d',  color: '#7bcbc8',   ms: 90 * 24 * 60 * 60 * 1000 },
    { label: '90d+',      color: '#475569',   ms: Infinity },
    { label: 'Never',     color: '#334155',   ms: -1 },
];

function buildBuckets(users: ClerkUser[]) {
    const now = Date.now();
    const counts = new Array(BUCKETS.length).fill(0);

    for (const u of users) {
        if (!u.last_sign_in_at) {
            counts[5]++; // Never
            continue;
        }
        const age = now - u.last_sign_in_at;
        if (age <= BUCKETS[0].ms) counts[0]++;
        else if (age <= BUCKETS[1].ms) counts[1]++;
        else if (age <= BUCKETS[2].ms) counts[2]++;
        else if (age <= BUCKETS[3].ms) counts[3]++;
        else counts[4]++;
    }

    return BUCKETS.map((b, i) => ({ ...b, count: counts[i] }));
}

function renderTooltip(t: TooltipState) {
    const tw = Math.max(t.text.length * 6.5 + 16, 50);
    const th = 20;
    const tx = Math.min(Math.max(t.x - tw / 2, 0), W - tw);
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

export function UserRetentionChart(p: UserRetentionChartProps) {
    const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);

    const data = () => buildBuckets(p.users ?? []);
    const total = () => (p.users ?? []).length;
    const max = () => Math.max(...data().map(d => d.count), 1);

    const BAR_H = IH / BUCKETS.length;
    const BAR_INNER = BAR_H * 0.55;

    const bars = () =>
        data().map((d, i) => {
            const barW = (d.count / max()) * IW;
            const y = PAD.top + i * BAR_H + (BAR_H - BAR_INNER) / 2;
            return { ...d, barW, y };
        });

    return (
        <div class="activity-graph-section">
            <div class="activity-graph-header">
                <div>
                    <span class="activity-graph-title">User Retention</span>
                    <span class="activity-graph-subtitle">
                        (by last sign-in — {total()} user{total() !== 1 ? 's' : ''})
                    </span>
                </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} width="100%" class="activity-graph-svg">
                <For each={bars()}>
                    {(bar) => {
                        const pct = total() > 0 ? Math.round((bar.count / total()) * 100) : 0;
                        const midY = bar.y + BAR_INNER / 2;
                        return (
                            <g>
                                {/* Row label */}
                                <text
                                    x={PAD.left - 8}
                                    y={midY + 4}
                                    text-anchor="end"
                                    font-size="11"
                                    font-weight="500"
                                    fill="#64748b"
                                >{bar.label}</text>

                                {/* Background track */}
                                <rect
                                    x={PAD.left}
                                    y={bar.y}
                                    width={IW}
                                    height={BAR_INNER}
                                    rx="3"
                                    fill="rgba(255,255,255,0.06)"
                                />

                                {/* Filled bar */}
                                <rect
                                    x={PAD.left}
                                    y={bar.y}
                                    width={Math.max(bar.barW, bar.count > 0 ? 4 : 0)}
                                    height={BAR_INNER}
                                    rx="3"
                                    fill={bar.color}
                                    style={{ cursor: 'default' }}
                                    onMouseEnter={() => setTooltip({
                                        x: PAD.left + bar.barW / 2,
                                        y: bar.y,
                                        text: `${bar.label}: ${bar.count} user${bar.count !== 1 ? 's' : ''} (${pct}%)`,
                                    })}
                                    onMouseLeave={() => setTooltip(null)}
                                />

                                {/* Count label */}
                                <text
                                    x={PAD.left + Math.max(bar.barW, bar.count > 0 ? 4 : 0) + 8}
                                    y={midY + 4}
                                    font-size="10"
                                    fill="#64748b"
                                    style={{ "pointer-events": "none" }}
                                >{bar.count} ({pct}%)</text>

                            </g>
                        );
                    }}
                </For>

                {tooltip() && renderTooltip(tooltip()!)}
            </svg>
        </div>
    );
}
