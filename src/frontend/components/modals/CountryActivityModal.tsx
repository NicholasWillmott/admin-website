import { createSignal, createMemo, For, Show } from 'solid-js';
import type { ClerkUser, ClerkSession, Server, HealthCheckResponse } from '../../types.ts';

interface CountryActivityModalProps {
    users: ClerkUser[] | undefined;
    servers: Server[] | undefined;
    onFetchInstanceStatus: (serverId: string) => Promise<HealthCheckResponse | null>;
    onFetchSessions: (userId: string, since?: number) => Promise<ClerkSession[]>;
    hUsers: string[];
    onClose: () => void;
}

const TARGET_KEYWORDS = ['Burkina', 'Congo', 'Liberia', 'Nigeria', 'Sierra', 'Zambia', 'Ghana'];

function isTargetServer(label: string): boolean {
    return TARGET_KEYWORDS.some(k => label.toLowerCase().includes(k.toLowerCase()));
}

function getPrimaryEmail(user: ClerkUser): string {
    return user.email_addresses.find(e => e.id === user.primary_email_address_id)?.email_address ?? '';
}

async function pMap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let i = 0;
    async function worker(): Promise<void> {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

const FROM_DATE = '2026-02-12';
const FROM_MS = new Date(FROM_DATE + 'T00:00:00').getTime();

function buildDateRange(): string[] {
    const dates: string[] = [];
    const cur = new Date(FROM_DATE + 'T00:00:00');
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    while (cur <= end) {
        dates.push(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
    }
    return dates;
}

const ALL_DATES = buildDateRange();
const TO_MS = new Date().setHours(23, 59, 59, 999);

interface ServerChartData {
    server: Server;
    counts: number[];
}

// ── SVG layout constants (display) ──────────────────────────────────────────
const DW = 660;
const DH = 90;
const DPAD = { top: 12, right: 12, bottom: 24, left: 28 };
const DIW = DW - DPAD.left - DPAD.right;
const DIH = DH - DPAD.top - DPAD.bottom;
const DBASELINE = DH - DPAD.bottom;

function xPosFn(iw: number, total: number) {
    return (i: number) => total > 1 ? (i / (total - 1)) * iw : iw / 2;
}

const xDisplay = xPosFn(DIW, ALL_DATES.length);

function buildXLabels(padLeft: number, xFn: (i: number) => number): { x: number; label: string }[] {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const labels: { x: number; label: string }[] = [];
    let lastMonth = -1;
    ALL_DATES.forEach((date, i) => {
        const d = new Date(date);
        const m = d.getMonth();
        if (m !== lastMonth) {
            labels.push({ x: padLeft + xFn(i), label: MONTHS[m] });
            lastMonth = m;
        } else if (d.getDate() === 15) {
            labels.push({ x: padLeft + xFn(i), label: '15' });
        }
    });
    return labels;
}

const DISPLAY_X_LABELS = buildXLabels(DPAD.left, xDisplay);

// ── Download SVG generation ──────────────────────────────────────────────────
const EW = 900;
const EH = 220;
const EPAD = { top: 52, right: 24, bottom: 44, left: 48 };
const EIW = EW - EPAD.left - EPAD.right;
const EIH = EH - EPAD.top - EPAD.bottom;
const EBASELINE = EH - EPAD.bottom;

const xExport = xPosFn(EIW, ALL_DATES.length);
const EXPORT_X_LABELS = buildXLabels(EPAD.left, xExport);

function escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildExportSvg(label: string, counts: number[]): string {
    const GREEN = '#0e706c';
    const max = Math.max(...counts, 1);
    const mid = Math.ceil(max / 2);

    const pts = counts.map((count, i) => ({
        x: EPAD.left + xExport(i),
        y: EPAD.top + EIH - (count / max) * EIH,
    }));

    const linePath = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${EBASELINE} L${pts[0].x.toFixed(1)},${EBASELINE} Z`;

    const yTicks = [
        { value: 0, y: EBASELINE },
        { value: mid, y: EPAD.top + EIH - (mid / max) * EIH },
        { value: max, y: EPAD.top },
    ];

    const fromLabel = new Date(FROM_DATE).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const toLabel = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${EW} ${EH}" width="${EW}" height="${EH}">`;
    s += `<rect width="${EW}" height="${EH}" fill="#141414" rx="10"/>`;
    s += `<text x="${EPAD.left}" y="24" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="#ffffff">${escape(label)}</text>`;
    s += `<text x="${EPAD.left}" y="40" font-family="system-ui,sans-serif" font-size="11" fill="#888">Unique sign-ins per day (Clerk sessions) · ${escape(fromLabel)} – ${escape(toLabel)}</text>`;

    for (const t of yTicks) {
        s += `<line x1="${EPAD.left}" y1="${t.y.toFixed(1)}" x2="${EW - EPAD.right}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
        s += `<text x="${EPAD.left - 6}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="#667">${t.value}</text>`;
    }

    s += `<path d="${areaPath}" fill="${GREEN}" fill-opacity="0.10"/>`;
    s += `<path d="${linePath}" fill="none" stroke="${GREEN}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

    for (const lbl of EXPORT_X_LABELS) {
        s += `<text x="${lbl.x.toFixed(1)}" y="${EH - EPAD.bottom + 16}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#667">${escape(lbl.label)}</text>`;
    }

    s += '</svg>';
    return s;
}

function downloadSvg(label: string, counts: number[]) {
    const svg = buildExportSvg(label, counts);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-daily-activity.svg`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Chart component ──────────────────────────────────────────────────────────
function ServerChart(p: { server: Server; counts: number[] }) {
    const max = () => Math.max(...p.counts, 1);
    const total = () => p.counts.reduce((a, b) => a + b, 0);
    const peak = () => Math.max(...p.counts);

    const pts = () => p.counts.map((count, i) => ({
        x: DPAD.left + xDisplay(i),
        y: DPAD.top + DIH - (count / max()) * DIH,
        count,
    }));

    const linePath = () => pts().map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
    const areaPath = () => {
        const p2 = pts();
        return `${linePath()} L${p2[p2.length - 1].x.toFixed(1)},${DBASELINE} L${p2[0].x.toFixed(1)},${DBASELINE} Z`;
    };

    const yTicks = () => {
        const m = max();
        const mid = Math.ceil(m / 2);
        return [
            { value: 0, y: DBASELINE },
            { value: mid, y: DPAD.top + DIH - (mid / m) * DIH },
            { value: m, y: DPAD.top },
        ];
    };

    return (
        <div style="border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px 16px; background: rgba(255,255,255,0.02)">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                <div>
                    <span style="font-weight: 600; color: #fff; font-size: 14px">{p.server.label}</span>
                    <span style="color: #94a3b8; font-size: 12px; margin-left: 10px">
                        peak {peak()} · {total()} total sessions
                    </span>
                </div>
                <button
                    type="button"
                    class="activity-btn"
                    style="font-size: 11px; padding: 3px 8px"
                    onClick={() => downloadSvg(p.server.label, p.counts)}
                >Download SVG</button>
            </div>
            <svg viewBox={`0 0 ${DW} ${DH}`} width="100%" style="display: block">
                <For each={yTicks()}>
                    {(tick) => (
                        <g>
                            <line x1={DPAD.left} y1={tick.y} x2={DW - DPAD.right} y2={tick.y} stroke="rgba(255,255,255,0.06)" stroke-width="1" />
                            <text x={DPAD.left - 4} y={tick.y + 4} text-anchor="end" font-size="9" fill="#667">{tick.value}</text>
                        </g>
                    )}
                </For>
                <path d={areaPath()} fill="#0e706c" fill-opacity="0.10" />
                <path d={linePath()} fill="none" stroke="#0e706c" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
                <For each={DISPLAY_X_LABELS}>
                    {(lbl) => (
                        <text x={lbl.x} y={DH - DPAD.bottom + 14} text-anchor="middle" font-size="9" fill="#667">{lbl.label}</text>
                    )}
                </For>
            </svg>
        </div>
    );
}

// ── Main modal ───────────────────────────────────────────────────────────────
export function CountryActivityModal(p: CountryActivityModalProps) {
    const [charts, setCharts] = createSignal<ServerChartData[]>([]);
    const [loadState, setLoadState] = createSignal<'idle' | 'loading' | 'done'>('idle');
    const [progress, setProgress] = createSignal({ done: 0, total: 0, phase: '' });

    const hUserSet = createMemo(() => new Set(p.hUsers));

    const targetServers = createMemo(() =>
        (p.servers ?? []).filter(s => isTargetServer(s.label))
    );

    async function fetchData() {
        setLoadState('loading');
        setCharts([]);

        const servers = targetServers();

        // Phase 1: server user lists
        setProgress({ done: 0, total: servers.length, phase: 'Fetching server user lists' });
        const serverUserLists = new Map<string, string[]>();
        await pMap(servers, 5, async (server) => {
            const status = await p.onFetchInstanceStatus(server.id);
            const emails: string[] = status?.serverUsers ?? status?.adminUsers ?? [];
            serverUserLists.set(server.id, emails.filter(e => !hUserSet().has(e)));
            setProgress(prev => ({ ...prev, done: prev.done + 1 }));
        });

        // Phase 2: build email → Clerk user map
        const userByEmail = new Map<string, ClerkUser>();
        for (const u of p.users ?? []) {
            const email = getPrimaryEmail(u);
            if (email) userByEmail.set(email, u);
        }

        // Unique emails across all target servers
        const allEmails = new Set<string>();
        for (const emails of serverUserLists.values()) {
            for (const e of emails) allEmails.add(e);
        }
        const emailList = [...allEmails];

        // Phase 3: fetch Clerk sessions
        setProgress({ done: 0, total: emailList.length, phase: 'Fetching Clerk sessions' });

        // email → set of session-day strings
        const emailDays = new Map<string, Set<string>>();
        await pMap(emailList, 8, async (email) => {
            const user = userByEmail.get(email);
            if (user) {
                const sessions = await p.onFetchSessions(user.id, FROM_MS);
                const days = new Set<string>();
                for (const s of sessions) {
                    if (s.created_at <= TO_MS) {
                        days.add(new Date(s.created_at).toISOString().split('T')[0]);
                    }
                }
                emailDays.set(email, days);
            }
            setProgress(prev => ({ ...prev, done: prev.done + 1 }));
        });

        // Phase 4: build per-server daily counts
        const result: ServerChartData[] = servers.map(server => {
            const serverEmails = serverUserLists.get(server.id) ?? [];
            const counts = ALL_DATES.map(date => {
                let unique = 0;
                for (const email of serverEmails) {
                    if (emailDays.get(email)?.has(date)) unique++;
                }
                return unique;
            });
            return { server, counts };
        });

        setCharts(result);
        setLoadState('done');
    }

    function downloadAll() {
        for (const { server, counts } of charts()) {
            downloadSvg(server.label, counts);
        }
    }

    function downloadCsv() {
        const data = charts();
        const header = ['Date', ...data.map(c => c.server.label)];
        const rows = ALL_DATES.map((date, i) =>
            [date, ...data.map(c => String(c.counts[i] ?? 0))]
        );
        const csv = [header, ...rows].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `country-daily-activity-${FROM_DATE}-to-${ALL_DATES[ALL_DATES.length - 1]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    const fromLabel = new Date(FROM_DATE).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const toLabel = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div
                class="modal-content"
                onClick={(e) => e.stopPropagation()}
                style="max-width: 780px; max-height: 88vh; overflow-y: auto"
            >
                <div class="modal-header">
                    <div>
                        <h2 style="margin: 0">Daily Activity by Country</h2>
                        <p style="color: #94a3b8; font-size: 13px; margin: 2px 0 0">
                            Unique sign-ins per day (Clerk sessions) · {fromLabel} – {toLabel}
                        </p>
                    </div>
                    <button class="modal-close" onClick={p.onClose}>✕</button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; flex-direction: column; gap: 16px">

                        <Show when={loadState() === 'idle'}>
                            <div style="display: flex; gap: 8px">
                                <button
                                    type="button"
                                    class="action-btn"
                                    style="flex: 1"
                                    onClick={p.onClose}
                                >Cancel</button>
                                <button
                                    type="button"
                                    class="action-btn"
                                    style="flex: 1"
                                    disabled={targetServers().length === 0}
                                    onClick={fetchData}
                                >
                                    Load Charts ({targetServers().length} servers)
                                </button>
                            </div>
                        </Show>

                        <Show when={loadState() === 'loading'}>
                            <div style="display: flex; flex-direction: column; gap: 8px">
                                <p style="color: #94a3b8; font-size: 13px">{progress().phase}…</p>
                                <div style="background: rgba(255, 255, 255, 0.08); border-radius: 999px; height: 6px; overflow: hidden">
                                    <div
                                        style={`background: #22c55e; height: 100%; width: ${progress().total > 0 ? Math.round((progress().done / progress().total) * 100) : 0}%; transition: width 0.2s`}
                                    />
                                </div>
                                <p style="color: #94a3b8; font-size: 12px">{progress().done} / {progress().total}</p>
                            </div>
                        </Show>

                        <Show when={loadState() === 'done'}>
                            <div style="display: flex; justify-content: flex-end; gap: 8px">
                                <button
                                    type="button"
                                    class="activity-btn"
                                    onClick={() => { setLoadState('idle'); setCharts([]); }}
                                >Reset</button>
                                <button
                                    type="button"
                                    class="activity-btn"
                                    onClick={downloadAll}
                                >Download All SVGs</button>
                                <button
                                    type="button"
                                    class="activity-btn"
                                    onClick={downloadCsv}
                                >Download CSV</button>
                            </div>
                            <For each={charts()}>
                                {({ server, counts }) => (
                                    <ServerChart server={server} counts={counts} />
                                )}
                            </For>
                            {charts().length === 0 && (
                                <p style="color: #94a3b8; font-size: 13px">No matching country servers found.</p>
                            )}
                        </Show>

                    </div>
                </div>
            </div>
        </div>
    );
}
