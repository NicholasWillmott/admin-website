import { For, Show, createSignal } from 'solid-js';
import type { WhatsNewEventRow } from '../../services.ts';
import { whatsNewWeekOf } from '../../services.ts';

const WN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_TREND_WEEKS = 26;

// Chart geometry (viewBox units; the SVG scales to its container)
const EG_W = 620;
const EG_H = 150;
const EG_PAD = { top: 14, right: 16, bottom: 30, left: 34 };
const EG_IW = EG_W - EG_PAD.left - EG_PAD.right;
const EG_IH = EG_H - EG_PAD.top - EG_PAD.bottom;
const EG_BASELINE = EG_H - EG_PAD.bottom;

function weekLabel(week: string): string {
  const d = new Date(`${week}T00:00:00Z`);
  return `${d.getUTCDate()} ${WN_MONTHS[d.getUTCMonth()]}`;
}

interface WeekBucket {
  week: string;
  seen: number;
  skipped: number;
  completed: number;
}

export interface FunnelCounts {
  seen: number;
  skipped: number;
  completed: number;
}

// Unique users per event across the fleet, deduped as serverId:email — the
// same email on two instances counts twice, matching per-instance reach
export function funnelCounts(rows: WhatsNewEventRow[]): FunnelCounts {
  const sets = { seen: new Set<string>(), skipped: new Set<string>(), completed: new Set<string>() };
  for (const row of rows) sets[row.event].add(`${row.serverId}:${row.userEmail}`);
  return { seen: sets.seen.size, skipped: sets.skipped.size, completed: sets.completed.size };
}

export function completionRateOf(counts: FunnelCounts): number | null {
  return counts.seen > 0 ? Math.round((counts.completed / counts.seen) * 100) : null;
}

function renderEgTooltip(t: { x: number; y: number; text: string }) {
  const tw = Math.max(t.text.length * 6.5 + 16, 50);
  const tx = Math.min(Math.max(t.x - tw / 2, EG_PAD.left), EG_W - EG_PAD.right - tw);
  const ty = Math.max(t.y - 30, 4);
  return (
    <g style={{ 'pointer-events': 'none' }}>
      <rect x={tx} y={ty} width={tw} height={20} rx="4" fill="#1a2e22" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
      <text x={tx + tw / 2} y={ty + 13} text-anchor="middle" font-size="10" font-weight="500" fill="#e2e8f0">
        {t.text}
      </text>
    </g>
  );
}

// Funnel + weekly-reach panel for one post. Rows are that post's events across
// the whole fleet; users are deduped as serverId:email (same email on two
// instances counts twice, matching the list-item stats).
export function PostEngagement(p: { rows: WhatsNewEventRow[] }) {
  const [tooltip, setTooltip] = createSignal<{ x: number; y: number; text: string } | null>(null);

  const funnel = () => funnelCounts(p.rows);
  const completionRate = () => completionRateOf(funnel());

  const allWeekly = (): WeekBucket[] => {
    const byWeek = new Map<string, { seen: Set<string>; skipped: Set<string>; completed: Set<string> }>();
    for (const row of p.rows) {
      if (!row.week) continue;
      let b = byWeek.get(row.week);
      if (!b) {
        b = { seen: new Set(), skipped: new Set(), completed: new Set() };
        byWeek.set(row.week, b);
      }
      b[row.event].add(`${row.serverId}:${row.userEmail}`);
    }
    if (byWeek.size === 0) return [];
    const firstWeek = [...byWeek.keys()].sort()[0];
    const currentWeek = whatsNewWeekOf(new Date().toISOString());
    // Contiguous Mondays from the first event through this week, zero-filled,
    // so a post that stopped reaching people shows the decay honestly
    const out: WeekBucket[] = [];
    const cursor = new Date(`${firstWeek}T00:00:00Z`);
    for (let i = 0; i < 500; i++) {
      const week = cursor.toISOString().slice(0, 10);
      const b = byWeek.get(week);
      out.push({ week, seen: b?.seen.size ?? 0, skipped: b?.skipped.size ?? 0, completed: b?.completed.size ?? 0 });
      if (week >= currentWeek) break;
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return out;
  };

  const weekly = () => allWeekly().slice(-MAX_TREND_WEEKS);
  const truncated = () => allWeekly().length > MAX_TREND_WEEKS;

  const bars = () => {
    const data = weekly();
    const max = Math.max(...data.map(b => b.seen), 1);
    const slot = EG_IW / data.length;
    const barWidth = Math.min(slot * 0.6, 28);
    const labelStep = Math.max(1, Math.ceil(data.length / 8));
    return data.map((b, i) => ({
      ...b,
      x: EG_PAD.left + i * slot + (slot - barWidth) / 2,
      y: EG_PAD.top + EG_IH - (b.seen / max) * EG_IH,
      width: barWidth,
      height: (b.seen / max) * EG_IH,
      showLabel: i % labelStep === 0,
    }));
  };

  const yTicks = () => {
    const max = Math.max(...weekly().map(b => b.seen), 1);
    const mid = Math.ceil(max / 2);
    return [
      { value: 0, y: EG_BASELINE },
      { value: mid, y: EG_PAD.top + EG_IH - (mid / max) * EG_IH },
      { value: max, y: EG_PAD.top },
    ];
  };

  const funnelStages = () => {
    const f = funnel();
    const max = Math.max(f.seen, f.completed, f.skipped, 1);
    return [
      { label: 'Seen', count: f.seen, pct: (f.seen / max) * 100, color: '#14b8a6' },
      { label: 'Completed', count: f.completed, pct: (f.completed / max) * 100, color: '#5eead4' },
      { label: 'Skipped', count: f.skipped, pct: (f.skipped / max) * 100, color: 'rgba(148, 163, 184, 0.55)' },
    ];
  };

  return (
    <Show
      when={p.rows.length > 0}
      fallback={
        <div class="whats-new-engagement whats-new-engagement-empty">
          No engagement recorded yet — stats appear once platform users see this post.
        </div>
      }
    >
      <div class="whats-new-engagement">
        <div class="wn-funnel">
          <For each={funnelStages()}>
            {(stage) => (
              <div class="wn-funnel-row">
                <div class="wn-funnel-head">
                  <span class="wn-funnel-label">{stage.label}</span>
                  <span class="wn-funnel-count">{stage.count}</span>
                </div>
                <div class="wn-funnel-track">
                  <div class="wn-funnel-fill" style={{ width: `${stage.pct}%`, background: stage.color }} />
                </div>
              </div>
            )}
          </For>
          <div class="wn-funnel-note">
            <Show when={completionRate() !== null}>
              <span class="wn-funnel-rate">{completionRate()}% completion</span> ·{' '}
            </Show>
            unique users across all instances
          </div>
        </div>

        <div class="wn-engagement-chart">
          <div class="wn-engagement-chart-header">
            <span class="wn-engagement-chart-title">Users reached per week</span>
            <Show when={truncated()}>
              <span class="wn-engagement-chart-range">Last {MAX_TREND_WEEKS} weeks</span>
            </Show>
          </div>
          <svg viewBox={`0 0 ${EG_W} ${EG_H}`} width="100%" class="wn-engagement-svg">
            <For each={yTicks()}>
              {(tick) => (
                <g>
                  <line
                    x1={EG_PAD.left} y1={tick.y}
                    x2={EG_W - EG_PAD.right} y2={tick.y}
                    stroke="rgba(255,255,255,0.08)" stroke-width="1"
                  />
                  <text x={EG_PAD.left - 4} y={tick.y + 4} text-anchor="end" font-size="9" fill="#94a3b8">
                    {tick.value}
                  </text>
                </g>
              )}
            </For>
            <For each={bars()}>
              {(bar) => (
                <g>
                  <rect
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={Math.max(bar.height, 0.5)}
                    rx="3"
                    fill={bar.seen > 0 ? '#0e706c' : 'rgba(255,255,255,0.08)'}
                    fill-opacity={bar.seen > 0 ? '0.85' : '1'}
                    style={{ cursor: 'default' }}
                    onMouseEnter={() => setTooltip({
                      x: bar.x + bar.width / 2,
                      y: bar.y,
                      text: `Wk of ${weekLabel(bar.week)}: ${bar.seen} seen · ${bar.completed} completed · ${bar.skipped} skipped`,
                    })}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  <Show when={bar.showLabel}>
                    <text
                      x={bar.x + bar.width / 2}
                      y={EG_BASELINE + 14}
                      text-anchor="middle"
                      font-size="9"
                      fill="#94a3b8"
                      style={{ 'pointer-events': 'none' }}
                    >{weekLabel(bar.week)}</text>
                  </Show>
                </g>
              )}
            </For>
            {tooltip() && renderEgTooltip(tooltip()!)}
          </svg>
        </div>
      </div>
    </Show>
  );
}
