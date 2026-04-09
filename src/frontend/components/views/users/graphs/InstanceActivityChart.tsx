import { createSignal, For, Show } from 'solid-js';
import type { Server, ServerUserLogs } from '../../../../types.ts';

interface InstanceActivityChartProps {
  servers: Server[] | undefined;
  userLogs: ServerUserLogs | undefined;
}

type TooltipState = { x: number; y: number; text: string };
type DayFilter = 7 | 14 | 30 | null;

const FILTERS: { label: string; value: DayFilter }[] = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: 'All time', value: null },
];

const W = 680;
const H = 180;
const PAD = { top: 20, right: 16, bottom: 56, left: 36 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top - PAD.bottom;
const BASELINE = H - PAD.bottom;

export function InstanceActivityChart(p: InstanceActivityChartProps) {
  const [tooltip, setTooltip] = createSignal<TooltipState | null>(null);
  const [dayFilter, setDayFilter] = createSignal<DayFilter>(7);

  const data = () => {
    if (!p.servers || !p.userLogs) return [];
    const cutoff = dayFilter() !== null ? Date.now() - dayFilter()! * 24 * 60 * 60 * 1000 : null;
    return p.servers
      .map(server => {
        const logs = p.userLogs![server.id] ?? [];
        const uniqueUsers = new Set(
          logs
            .filter(l => l.endpoint === 'getInstanceDetail')
            .filter(l => cutoff === null || new Date(l.timestamp).getTime() >= cutoff)
            .map(l => l.user_email)
        );
        return { label: server.label, id: server.id, count: uniqueUsers.size };
      })
      .sort((a, b) => b.count - a.count);
  };

  const max = () => Math.max(...data().map(d => d.count), 1);

  const barWidth = () => {
    const n = data().length;
    if (n === 0) return 20;
    return Math.min(Math.max((IW / n) * 0.6, 6), 40);
  };

  const barX = (i: number) => {
    const n = data().length;
    const step = n > 1 ? IW / (n - 1) : IW / 2;
    const cx = n > 1 ? PAD.left + i * step : PAD.left + IW / 2;
    return cx - barWidth() / 2;
  };

  const barH = (count: number) => (count / max()) * IH;

  const yTicks = () => {
    const m = max();
    const mid = Math.ceil(m / 2);
    return [
      { value: 0, y: BASELINE },
      { value: mid, y: PAD.top + IH - (mid / m) * IH },
      { value: m, y: PAD.top },
    ];
  };

  const labelX = (i: number) => barX(i) + barWidth() / 2;

  return (
    <div class="activity-graph-section">
      <div class="activity-graph-header">
        <div>
          <span class="activity-graph-title">Unique Active Users per Instance</span>
          <span class="activity-graph-subtitle">(sorted by activity)</span>
        </div>
        <div class="activity-graph-toggle">
          <For each={FILTERS}>{(f) => (
            <button
              type="button"
              class={`activity-graph-btn${dayFilter() === f.value ? ' active' : ''}`}
              onClick={() => setDayFilter(f.value)}
            >{f.label}</button>
          )}</For>
        </div>
      </div>
      <Show when={data().length === 0}>
        <p style="color: #64748b; font-size: 13px; padding: 12px 0">No activity data available.</p>
      </Show>
      <Show when={data().length > 0}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" class="activity-graph-svg">
          <For each={yTicks()}>
            {(tick) => (
              <g>
                <line
                  x1={PAD.left} y1={tick.y}
                  x2={W - PAD.right} y2={tick.y}
                  stroke="rgba(255,255,255,0.08)" stroke-width="1"
                />
                <text
                  x={PAD.left - 4} y={tick.y + 4}
                  text-anchor="end"
                  font-size="9"
                  fill="#64748b"
                >{tick.value}</text>
              </g>
            )}
          </For>

          <For each={data()}>
            {(d, i) => {
              const bh = barH(d.count);
              const bx = barX(i());
              const by = BASELINE - bh;
              const cx = labelX(i());
              return (
                <g>
                  <rect
                    x={bx} y={by}
                    width={barWidth()} height={Math.max(bh, d.count > 0 ? 2 : 0)}
                    fill="#0e706c"
                    fill-opacity="0.85"
                    rx="2"
                    style={{ cursor: 'default' }}
                    onMouseEnter={() => setTooltip({ x: cx, y: by, text: `${d.label}: ${d.count} user${d.count !== 1 ? 's' : ''}` })}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  <text
                    x={cx}
                    y={BASELINE + 10}
                    text-anchor="end"
                    font-size="8"
                    fill="#64748b"
                    transform={`rotate(-40, ${cx}, ${BASELINE + 10})`}
                  >{d.label}</text>
                </g>
              );
            }}
          </For>

          {tooltip() && (() => {
            const t = tooltip()!;
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
          })()}
        </svg>
      </Show>
    </div>
  );
}
