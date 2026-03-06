import { createSignal, createEffect, For } from 'solid-js';
import type { ClerkUser } from '../../../../types.ts';

type TooltipState = { x: number; y: number; text: string };

interface UserRegistrationsGraphProps {
    users: ClerkUser[] | undefined;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const W = 680;
const H = 130;
const PAD = { top: 14, right: 16, bottom: 28, left: 32 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top - PAD.bottom;
const BASELINE = H - PAD.bottom;

function buildYearData(users: ClerkUser[], year: number) {
    const counts = new Array(12).fill(0);
    for (const u of users) {
        const d = new Date(u.created_at);
        if (d.getFullYear() === year) {
            counts[d.getMonth()]++;
        }
    }
    return counts.map((count, i) => ({ label: MONTH_NAMES[i], count }));
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

export function UserRegistrationsGraph(p: UserRegistrationsGraphProps) {
    const currentYear = new Date().getFullYear();
    const [year, setYear] = createSignal(currentYear);
    const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);

    const data = () => buildYearData(p.users ?? [], year());

    const max = () => Math.max(...data().map(d => d.count), 1);

    const slotWidth = IW / 12;
    const barWidth = slotWidth * 0.55;

    const bars = () => {
        const m = max();
        return data().map((d, i) => ({
            x: PAD.left + i * slotWidth + (slotWidth - barWidth) / 2,
            y: PAD.top + IH - (d.count / m) * IH,
            height: (d.count / m) * IH,
            count: d.count,
            label: d.label,
        }));
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

    const availableYears = () => {
        const users = p.users ?? [];
        const years = new Set<number>();
        for (const u of users) {
            years.add(new Date(u.created_at).getFullYear());
        }
        return [...years].sort((a, b) => b - a);
    };

    createEffect(() => {
        const years = availableYears();
        if (years.length > 0 && !years.includes(year())) {
            setYear(years[0]);
        }
    });

    return (
        <div class="activity-graph-section">
            <div class="activity-graph-header">
                <span class="activity-graph-title">New User Registrations</span>
                <select
                    class="graph-year-select"
                    value={year()}
                    onChange={(e) => setYear(Number(e.currentTarget.value))}
                >
                    <For each={availableYears()}>
                        {(y) => <option value={y}>{y}</option>}
                    </For>
                </select>
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

                <For each={bars()}>
                    {(bar) => (
                        <g>
                            <rect
                                x={bar.x}
                                y={bar.y}
                                width={barWidth}
                                height={Math.max(bar.height, 0.5)}
                                rx="3"
                                fill={bar.count > 0 ? '#0e706c' : '#e8e8e8'}
                                fill-opacity={bar.count > 0 ? '0.85' : '1'}
                                style={{ cursor: 'default' }}
                                onMouseEnter={() => setTooltip({
                                    x: bar.x + barWidth / 2,
                                    y: bar.y,
                                    text: `${bar.label}: ${bar.count} registration${bar.count !== 1 ? 's' : ''}`,
                                })}
                                onMouseLeave={() => setTooltip(null)}
                            />
                            <text
                                x={bar.x + barWidth / 2}
                                y={BASELINE + 14}
                                text-anchor="middle"
                                font-size="9"
                                fill="#bbb"
                                style={{ "pointer-events": "none" }}
                            >{bar.label}</text>
                        </g>
                    )}
                </For>

                {tooltip() && renderTooltip(tooltip()!)}
            </svg>
        </div>
    );
}
