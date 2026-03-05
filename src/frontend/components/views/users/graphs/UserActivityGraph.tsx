import { createSignal, For } from 'solid-js';
import type { ClerkUser } from '../../../../types.ts';

type TooltipState = { x: number; y: number; text: string };

interface UserActivityGraphProps {
    users: ClerkUser[] | undefined;
}

type GraphView = 'month' | 'year';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const W = 680;
const H = 110;
const PAD = { top: 14, right: 16, bottom: 28, left: 32 };
const IW = W - PAD.left - PAD.right; // inner width
const IH = H - PAD.top - PAD.bottom; // inner height
const BASELINE = H - PAD.bottom;

function buildMonthData(users: ClerkUser[], year: number, month: number) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const counts = new Array(daysInMonth).fill(0);
    for (const u of users) {
        if (!u.last_sign_in_at) continue;
        const d = new Date(u.last_sign_in_at);
        if (d.getFullYear() === year && d.getMonth() === month) {
            counts[d.getDate() - 1]++;
        }
    }
    return counts.map((count, i) => ({ label: String(i + 1), count }));
}

function buildYearData(users: ClerkUser[], year: number) {
    const counts = new Array(12).fill(0);
    for (const u of users) {
        if (!u.last_sign_in_at) continue;
        const d = new Date(u.last_sign_in_at);
        if (d.getFullYear() === year) {
            counts[d.getMonth()]++;
        }
    }
    return MONTH_NAMES.map((label, i) => ({ label, count: counts[i] }));
}

function computePoints(data: { label: string; count: number }[]) {
    const max = Math.max(...data.map(d => d.count), 1);
    return data.map((d, i) => ({
        x: data.length > 1 ? PAD.left + (i / (data.length - 1)) * IW : PAD.left + IW / 2,
        y: PAD.top + IH - (d.count / max) * IH,
        count: d.count,
        label: d.label,
    }));
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

export function UserActivityGraph(p: UserActivityGraphProps) {
    const [view, setView] = createSignal<GraphView>('month');
    const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    const data = () => {
        const users = p.users ?? [];
        return view() === 'month'
            ? buildMonthData(users, year, month)
            : buildYearData(users, year);
    };

    const pts = () => computePoints(data());

    const max = () => Math.max(...data().map(d => d.count), 1);

    const linePath = () => {
        const p = pts();
        if (p.length === 0) return '';
        return p.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    };

    const areaPath = () => {
        const p = pts();
        if (p.length === 0) return '';
        const first = p[0];
        const last = p[p.length - 1];
        return `${linePath()} L${last.x.toFixed(1)},${BASELINE} L${first.x.toFixed(1)},${BASELINE} Z`;
    };

    const xLabels = () => {
        const p = pts();
        if (view() === 'month') {
            return p.filter((_, i) => i === 0 || (i + 1) % 5 === 0 || i === p.length - 1);
        }
        return p;
    };

    const yTicks = () => {
        const m = max();
        const mid = Math.ceil(m / 2);
        return [
            { value: 0, y: BASELINE },
            { value: mid, y: PAD.top + IH - (mid / m) * IH },
            { value: m, y: PAD.top },
        ];
    };

    const currentMonthName = MONTH_NAMES[month];

    return (
        <div class="activity-graph-section">
            <div class="activity-graph-header">
                <div>
                    <span class="activity-graph-title">User Sign-in Activity</span>
                    <span class="activity-graph-subtitle">(by most recent sign-in per user)</span>
                </div>
                <div class="activity-graph-toggle">
                    <button
                        type="button"
                        class={`activity-graph-btn${view() === 'month' ? ' active' : ''}`}
                        onClick={() => setView('month')}
                    >{currentMonthName} {year}</button>
                    <button
                        type="button"
                        class={`activity-graph-btn${view() === 'year' ? ' active' : ''}`}
                        onClick={() => setView('year')}
                    >{year}</button>
                </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} width="100%" class="activity-graph-svg">
                <For each={yTicks()}>
                    {(tick) => (
                        <g>
                            <line
                                x1={PAD.left} y1={tick.y}
                                x2={W - PAD.right} y2={tick.y}
                                stroke="#e8e8e8" stroke-width="1"
                            />
                            <text
                                x={PAD.left - 4} y={tick.y + 4}
                                text-anchor="end"
                                font-size="9"
                                fill="#bbb"
                            >{tick.value}</text>
                        </g>
                    )}
                </For>

                <path d={areaPath()} fill="#0e706c" fill-opacity="0.08" />
                <path d={linePath()} fill="none" stroke="#0e706c" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />

                <For each={pts()}>
                    {(pt) => (
                        <g>
                            <circle
                                cx={pt.x} cy={pt.y}
                                r={pt.count > 0 ? 3 : 2}
                                fill={pt.count > 0 ? '#0e706c' : '#ddd'}
                                style={{ "pointer-events": "none" }}
                            />
                            <circle
                                cx={pt.x} cy={pt.y} r="8"
                                fill="transparent"
                                style={{ cursor: 'default' }}
                                onMouseEnter={() => setTooltip({
                                    x: pt.x,
                                    y: pt.y,
                                    text: `${view() === 'month' ? 'Day ' : ''}${pt.label}: ${pt.count} user${pt.count !== 1 ? 's' : ''}`,
                                })}
                                onMouseLeave={() => setTooltip(null)}
                            />
                        </g>
                    )}
                </For>

                <For each={xLabels()}>
                    {(pt) => (
                        <text
                            x={pt.x} y={H - PAD.bottom + 14}
                            text-anchor="middle"
                            font-size="9"
                            fill="#bbb"
                        >{pt.label}</text>
                    )}
                </For>

                {tooltip() && renderTooltip(tooltip()!)}
            </svg>
        </div>
    );
}
