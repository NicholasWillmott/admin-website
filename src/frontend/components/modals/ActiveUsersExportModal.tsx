import { createSignal, createMemo, For } from 'solid-js';
import type { ClerkUser, Server, ServerUserLogs } from '../../types.ts';

interface ActiveUsersExportModalProps {
    users: ClerkUser[] | undefined;
    servers: Server[] | undefined;
    userLogs: ServerUserLogs | undefined;
    initialInstance: string | null;
    onClose: () => void;
}

function getPrimaryEmail(user: ClerkUser): string {
    return user.email_addresses.find(e => e.id === user.primary_email_address_id)?.email_address ?? '';
}

function toDateInputValue(d: Date): string {
    return d.toISOString().split('T')[0];
}

export function ActiveUsersExportModal(p: ActiveUsersExportModalProps) {
    const today = new Date();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [fromDate, setFromDate] = createSignal(toDateInputValue(sevenDaysAgo));
    const [toDate, setToDate] = createSignal(toDateInputValue(today));

    const allServerIds = () => Object.keys(p.userLogs ?? {});
    const [selectedInstances, setSelectedInstances] = createSignal<Set<string>>(
        new Set(p.initialInstance ? [p.initialInstance] : allServerIds())
    );

    const toggleInstance = (id: string) => {
        setSelectedInstances(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const activeEmails = createMemo(() => {
        if (!p.userLogs) return new Set<string>();
        const from = new Date(fromDate() + 'T00:00:00').getTime();
        const to = new Date(toDate() + 'T23:59:59').getTime();
        const emails = new Set<string>();
        for (const id of selectedInstances()) {
            for (const log of p.userLogs[id] ?? []) {
                if (log.endpoint !== 'getInstanceDetail') continue;
                const ts = new Date(log.timestamp).getTime();
                if (ts >= from && ts <= to) emails.add(log.user_email);
            }
        }
        return emails;
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
        const rows = [['Name', 'Email']];
        for (const u of activeUsers()) {
            const email = getPrimaryEmail(u);
            if (excludedEmails().has(email)) continue;
            const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '-';
            rows.push([name, email]);
        }
        const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `active-users-${fromDate()}-to-${toDate()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        p.onClose();
    }

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 560px">
                <div class="modal-header">
                    <h2>Export Active Users</h2>
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
                                />
                                <span style="color: #aaa">to</span>
                                <input
                                    type="date"
                                    class="version-input"
                                    value={toDate()}
                                    onInput={(e) => setToDate(e.currentTarget.value)}
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
                                        onClick={() => setSelectedInstances(new Set(allServerIds()))}
                                    >All</button>
                                    <button
                                        type="button"
                                        class="activity-btn"
                                        onClick={() => setSelectedInstances(new Set())}
                                    >None</button>
                                </div>
                            </div>
                            <div style="max-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
                                <For each={p.servers ?? []}>
                                    {(server) => (
                                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #ccc">
                                            <input
                                                type="checkbox"
                                                checked={selectedInstances().has(server.id)}
                                                onChange={() => toggleInstance(server.id)}
                                            />
                                            {server.label} <span style="color: #666; font-size: 12px">({server.id})</span>
                                        </label>
                                    )}
                                </For>
                            </div>
                        </div>

                        {/* Users to exclude */}
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                                <p style="font-weight: 600; color: #fff">
                                    Active Users
                                    <span style="font-weight: 400; color: #aaa; margin-left: 6px; font-size: 13px">
                                        ({activeUsers().length} found — uncheck to exclude)
                                    </span>
                                </p>
                            </div>
                            <div style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
                                {activeUsers().length === 0
                                    ? <p style="color: #666; font-size: 13px">No active users found for the selected criteria.</p>
                                    : (
                                        <For each={activeUsers()}>
                                            {(user) => {
                                                const email = getPrimaryEmail(user);
                                                return (
                                                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #ccc">
                                                        <input
                                                            type="checkbox"
                                                            checked={!excludedEmails().has(email)}
                                                            onChange={() => toggleExclude(email)}
                                                        />
                                                        <span>{user.first_name} {user.last_name}</span>
                                                        <span style="color: #666; font-size: 12px">{email}</span>
                                                    </label>
                                                );
                                            }}
                                        </For>
                                    )
                                }
                            </div>
                        </div>

                        {/* Actions */}
                        <div style="display: flex; gap: 8px; margin-top: 4px">
                            <button
                                type="button"
                                class="action-btn"
                                style="flex: 1; background: #444; color: #fff"
                                onClick={p.onClose}
                            >
                                Cancel
                            </button>
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
                    </div>
                </div>
            </div>
        </div>
    );
}
