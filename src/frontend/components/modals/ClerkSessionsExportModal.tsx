import { createSignal, createMemo, For, Show } from 'solid-js';
import type { ClerkUser, ClerkSession, Server, HealthCheckResponse } from '../../types.ts';

interface ClerkSessionsExportModalProps {
    users: ClerkUser[] | undefined;
    servers: Server[] | undefined;
    onFetchInstanceStatus: (serverId: string) => Promise<HealthCheckResponse | null>;
    onFetchSessions: (userId: string, since?: number) => Promise<ClerkSession[]>;
    hUsers: string[];
    onClose: () => void;
}

function getPrimaryEmail(user: ClerkUser): string {
    return user.email_addresses.find(e => e.id === user.primary_email_address_id)?.email_address ?? '';
}

function toDateInputValue(d: Date): string {
    return d.toISOString().split('T')[0];
}

const TARGET_KEYWORDS = ['Burkina', 'Congo', 'Liberia', 'Nigeria', 'Sierra', 'Zambia', 'Ghana'];

function isTargetServer(label: string): boolean {
    return TARGET_KEYWORDS.some(k => label.toLowerCase().includes(k.toLowerCase()));
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

type LoadState = 'idle' | 'loading' | 'done';

export function ClerkSessionsExportModal(p: ClerkSessionsExportModalProps) {
    const today = new Date();

    const [fromDate, setFromDate] = createSignal('2026-02-12');
    const [toDate, setToDate] = createSignal(toDateInputValue(today));

    const initialSelected = new Set(
        (p.servers ?? []).filter(s => isTargetServer(s.label)).map(s => s.id)
    );
    const [selectedInstances, setSelectedInstances] = createSignal<Set<string>>(initialSelected);

    const toggleInstance = (id: string) => {
        setSelectedInstances(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const hUserSet = createMemo(() => new Set(p.hUsers));

    const [serverEmailCounts, setServerEmailCounts] = createSignal<Map<string, Map<string, number>>>(new Map());
    const [loadState, setLoadState] = createSignal<LoadState>('idle');
    const [progress, setProgress] = createSignal({ done: 0, total: 0, phase: '' });

    async function fetchData() {
        setLoadState('loading');
        setServerEmailCounts(new Map());
        setExcludedEmails(new Set<string>());

        const instances = [...selectedInstances()];
        const fromMs = new Date(fromDate() + 'T00:00:00').getTime();
        const toMs = new Date(toDate() + 'T23:59:59').getTime();

        // Step 1: Fetch server user lists from health check
        setProgress({ done: 0, total: instances.length, phase: 'Fetching server user lists' });
        const serverUserLists = new Map<string, string[]>();
        await pMap(instances, 5, async (serverId) => {
            const status = await p.onFetchInstanceStatus(serverId);
            const emails: string[] = status?.serverUsers ?? status?.adminUsers ?? [];
            serverUserLists.set(serverId, emails.filter(e => !hUserSet().has(e)));
            setProgress(prev => ({ ...prev, done: prev.done + 1 }));
        });

        // Step 2: Collect unique emails and build email -> ClerkUser map
        const allEmails = new Set<string>();
        for (const emails of serverUserLists.values()) {
            for (const e of emails) allEmails.add(e);
        }

        const userByEmail = new Map<string, ClerkUser>();
        for (const u of p.users ?? []) {
            const email = getPrimaryEmail(u);
            if (email) userByEmail.set(email, u);
        }

        // Step 3: Fetch Clerk sessions for each unique user
        const emailList = [...allEmails];
        setProgress({ done: 0, total: emailList.length, phase: 'Fetching Clerk sessions' });
        const emailSessionCounts = new Map<string, number>();

        await pMap(emailList, 8, async (email) => {
            const user = userByEmail.get(email);
            if (user) {
                const sessions = await p.onFetchSessions(user.id, fromMs);
                const count = sessions.filter(s => s.created_at <= toMs).length;
                emailSessionCounts.set(email, count);
            } else {
                emailSessionCounts.set(email, 0);
            }
            setProgress(prev => ({ ...prev, done: prev.done + 1 }));
        });

        // Step 4: Build per-server counts (only users with at least one session)
        const result = new Map<string, Map<string, number>>();
        for (const [serverId, emails] of serverUserLists) {
            const counts = new Map<string, number>();
            for (const email of emails) {
                const count = emailSessionCounts.get(email) ?? 0;
                if (count > 0) counts.set(email, count);
            }
            result.set(serverId, counts);
        }

        setServerEmailCounts(result);
        setLoadState('done');
    }

    const activeEmails = createMemo(() => {
        const all = new Set<string>();
        for (const counts of serverEmailCounts().values()) {
            for (const email of counts.keys()) all.add(email);
        }
        return all;
    });

    const activeUsers = createMemo(() =>
        (p.users ?? []).filter(u => activeEmails().has(getPrimaryEmail(u)))
    );

    const [excludedEmails, setExcludedEmails] = createSignal<Set<string>>(new Set());

    const toggleExclude = (email: string) => {
        setExcludedEmails(prev => {
            const next = new Set(prev);
            next.has(email) ? next.delete(email) : next.add(email);
            return next;
        });
    };

    const exportCount = () => activeUsers().filter(u => !excludedEmails().has(getPrimaryEmail(u))).length;

    function handleExport() {
        const instances = [...selectedInstances()];
        const serverLabel = new Map((p.servers ?? []).map(s => [s.id, s.label]));
        const userByEmail = new Map<string, ClerkUser>();
        for (const u of p.users ?? []) userByEmail.set(getPrimaryEmail(u), u);

        const instanceColumns = instances.map(id => {
            const counts = serverEmailCounts().get(id) ?? new Map<string, number>();
            return [...counts.keys()]
                .filter(email => !excludedEmails().has(email))
                .map(email => {
                    const u = userByEmail.get(email);
                    const name = u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || '-' : '-';
                    return [name, email, String(counts.get(email) ?? 0)];
                });
        });

        const header = instances.flatMap(id => {
            const label = serverLabel.get(id) ?? id;
            return [`${label} - Name`, `${label} - Email`, `${label} - Times Active`];
        });

        const maxRows = Math.max(...instanceColumns.map(col => col.length), 0);
        const rows = [header];
        for (let i = 0; i < maxRows; i++) {
            rows.push(instanceColumns.flatMap(col => col[i] ?? ['', '', '']));
        }

        const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `active-users-clerk-${fromDate()}-to-${toDate()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        p.onClose();
    }

    function reset() {
        setLoadState('idle');
        setServerEmailCounts(new Map());
        setExcludedEmails(new Set<string>());
    }

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 560px">
                <div class="modal-header">
                    <h2>Export Active Users (Clerk Sessions)</h2>
                    <button class="modal-close" onClick={p.onClose}>✕</button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; flex-direction: column; gap: 20px">

                        {/* Date range */}
                        <div>
                            <p style="font-weight: 600; margin-bottom: 8px; color: #fff">Date Range</p>
                            <div style="display: flex; gap: 12px; align-items: center">
                                <input
                                    type="date"
                                    class="version-input"
                                    value={fromDate()}
                                    onInput={(e) => setFromDate(e.currentTarget.value)}
                                    disabled={loadState() === 'loading'}
                                />
                                <span style="color: #94a3b8">to</span>
                                <input
                                    type="date"
                                    class="version-input"
                                    value={toDate()}
                                    onInput={(e) => setToDate(e.currentTarget.value)}
                                    disabled={loadState() === 'loading'}
                                />
                            </div>
                        </div>

                        {/* Instances */}
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                                <p style="font-weight: 600; color: #fff">Instances</p>
                                <div style="display: flex; gap: 8px">
                                    <button
                                        type="button"
                                        class="activity-btn"
                                        onClick={() => setSelectedInstances(new Set((p.servers ?? []).map(s => s.id)))}
                                        disabled={loadState() === 'loading'}
                                    >All</button>
                                    <button
                                        type="button"
                                        class="activity-btn"
                                        onClick={() => setSelectedInstances(new Set())}
                                        disabled={loadState() === 'loading'}
                                    >None</button>
                                </div>
                            </div>
                            <div style="max-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
                                <For each={p.servers ?? []}>
                                    {(server) => (
                                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #cbd5e1">
                                            <input
                                                type="checkbox"
                                                checked={selectedInstances().has(server.id)}
                                                onChange={() => toggleInstance(server.id)}
                                                disabled={loadState() === 'loading'}
                                            />
                                            {server.label}
                                            <span style="color: #94a3b8; font-size: 12px">({server.id})</span>
                                        </label>
                                    )}
                                </For>
                            </div>
                        </div>

                        {/* Fetch / progress */}
                        <Show when={loadState() !== 'done'}>
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
                            <div style="display: flex; gap: 8px">
                                <button
                                    type="button"
                                    class="action-btn"
                                    style="flex: 1"
                                    onClick={p.onClose}
                                    disabled={loadState() === 'loading'}
                                >Cancel</button>
                                <button
                                    type="button"
                                    class="action-btn"
                                    style="flex: 1"
                                    onClick={fetchData}
                                    disabled={loadState() === 'loading' || selectedInstances().size === 0}
                                >
                                    {loadState() === 'loading' ? 'Loading…' : 'Fetch Active Users'}
                                </button>
                            </div>
                        </Show>

                        {/* Results */}
                        <Show when={loadState() === 'done'}>
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                                    <p style="font-weight: 600; color: #fff">
                                        Active Users
                                        <span style="font-weight: 400; color: #94a3b8; margin-left: 6px; font-size: 13px">
                                            ({activeUsers().length} found — uncheck to exclude)
                                        </span>
                                    </p>
                                    <button type="button" class="activity-btn" onClick={reset}>Reset</button>
                                </div>
                                <div style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
                                    {activeUsers().length === 0
                                        ? <p style="color: #94a3b8; font-size: 13px">No active users found for the selected criteria.</p>
                                        : (
                                            <For each={activeUsers()}>
                                                {(user) => {
                                                    const email = getPrimaryEmail(user);
                                                    return (
                                                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #cbd5e1">
                                                            <input
                                                                type="checkbox"
                                                                checked={!excludedEmails().has(email)}
                                                                onChange={() => toggleExclude(email)}
                                                            />
                                                            <span>{user.first_name} {user.last_name}</span>
                                                            <span style="color: #94a3b8; font-size: 12px">{email}</span>
                                                        </label>
                                                    );
                                                }}
                                            </For>
                                        )
                                    }
                                </div>
                            </div>
                            <div style="display: flex; gap: 8px; margin-top: 4px">
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
                                    disabled={exportCount() === 0}
                                    onClick={handleExport}
                                >
                                    Export {exportCount()} User{exportCount() !== 1 ? 's' : ''}
                                </button>
                            </div>
                        </Show>

                    </div>
                </div>
            </div>
        </div>
    );
}
