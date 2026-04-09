import { createSignal, For } from 'solid-js';
import type { ClerkUser } from '../../../../types.ts';

interface EmailOptInChartProps {
    users: ClerkUser[] | undefined;
}

type TooltipState = { x: number; y: number; text: string };

const W = 680;
const H = 200;
const CX = W / 2;
const CY = H / 2;
const R = 70;

type Segment = { label: string; count: number; color: string };

function buildSegments(users: ClerkUser[]): Segment[] {
    let optedIn = 0;
    let optedOut = 0;
    let notAsked = 0;

    for (const u of users) {
        if (u.unsafe_metadata.emailOptIn === true) {
            optedIn++;
        } else if (u.unsafe_metadata.emailOptInAsked === true) {
            optedOut++;
        } else {
            notAsked++;
        }
    }

    return [
        { label: 'Opted In', count: optedIn, color: '#0e706c' },
        { label: 'Opted Out', count: optedOut, color: '#1a8f89' },
        { label: 'Not Asked', count: notAsked, color: '#334155' },
    ];
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
    return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
    };
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

export function EmailOptInChart(p: EmailOptInChartProps) {
    const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);

    const segments = () => buildSegments(p.users ?? []);
    const total = () => segments().reduce((s, seg) => s + seg.count, 0);

    const arcs = () => {
        const segs = segments();
        const t = total();
        if (t === 0) return [];

        let angle = -Math.PI / 2;
        return segs
            .filter(seg => seg.count > 0)
            .map(seg => {
                const sweep = (seg.count / t) * Math.PI * 2;
                const startAngle = angle;
                const endAngle = angle + sweep;
                const midAngle = startAngle + sweep / 2;
                const mid = polarToCartesian(CX, CY, R * 0.65, midAngle);
                angle = endAngle;
                return {
                    ...seg,
                    path: describeArc(CX, CY, R, startAngle, endAngle),
                    midX: mid.x,
                    midY: mid.y,
                    pct: Math.round((seg.count / t) * 100),
                };
            });
    };

    const LEGEND_X = CX + R + 40;
    const LEGEND_Y = CY - 30;

    return (
        <div class="activity-graph-section">
            <div class="activity-graph-header">
                <span class="activity-graph-title">Email Opt-In Rate</span>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} width="100%" class="activity-graph-svg">
                {total() === 0 ? (
                    <text x={CX} y={CY} text-anchor="middle" font-size="12" fill="#94a3b8">No data</text>
                ) : (
                    <>
                        <For each={arcs()}>
                            {(arc) => (
                                <path
                                    d={arc.path}
                                    fill={arc.color}
                                    stroke="#1a2e22"
                                    stroke-width="2"
                                    style={{ cursor: 'default' }}
                                    onMouseEnter={() => setTooltip({
                                        x: arc.midX,
                                        y: arc.midY,
                                        text: `${arc.label}: ${arc.count} (${arc.pct}%)`,
                                    })}
                                    onMouseLeave={() => setTooltip(null)}
                                />
                            )}
                        </For>

                        {/* Legend */}
                        <For each={segments().filter(s => s.count > 0)}>
                            {(seg, i) => (
                                <g>
                                    <rect
                                        x={LEGEND_X}
                                        y={LEGEND_Y + i() * 22}
                                        width="12"
                                        height="12"
                                        rx="2"
                                        fill={seg.color}
                                    />
                                    <text
                                        x={LEGEND_X + 18}
                                        y={LEGEND_Y + i() * 22 + 10}
                                        font-size="11"
                                        fill="#94a3b8"
                                    >
                                        {seg.label}: {seg.count} ({Math.round((seg.count / total()) * 100)}%)
                                    </text>
                                </g>
                            )}
                        </For>
                    </>
                )}

                {tooltip() && renderTooltip(tooltip()!)}
            </svg>
        </div>
    );
}
