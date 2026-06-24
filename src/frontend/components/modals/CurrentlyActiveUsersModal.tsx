import { createMemo, For, Show } from 'solid-js';
import type { ClerkUser, Server, ServerUserLogs } from '../../types.ts';

interface CurrentlyActiveUsersModalProps {
    users: ClerkUser[] | undefined;
    servers: Server[] | undefined;
    userLogs: ServerUserLogs | undefined;
    hUsers: string[];
    onClose: () => void;
}

function getPrimaryEmail(user: ClerkUser): string {
    return user.email_addresses.find(e => e.id === user.primary_email_address_id)?.email_address ?? '';
}

function timeAgo(timestamp: string): string {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    return `${mins} mins ago`;
}

interface ActiveUser {
    user: ClerkUser | null;
    email: string;
    lastSeen: string;
    serverIds: string[];
}

export function CurrentlyActiveUsersModal(p: CurrentlyActiveUsersModalProps) {
    const hUserSet = createMemo(() => new Set(p.hUsers));

    const activeUsers = createMemo((): ActiveUser[] => {
        if (!p.userLogs) return [];
        const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
        // Track most recent activity per email
        const emailMap = new Map<string, { lastSeen: string; serverIds: Set<string> }>();

        for (const [serverId, logs] of Object.entries(p.userLogs)) {
            for (const log of logs) {
                if (log.endpoint !== 'getCurrentUser') continue;
                if (hUserSet().has(log.user_email)) continue;
                const ts = new Date(log.timestamp).getTime();
                if (ts < thirtyMinsAgo) continue;

                const existing = emailMap.get(log.user_email);
                if (existing) {
                    if (log.timestamp > existing.lastSeen) existing.lastSeen = log.timestamp;
                    existing.serverIds.add(serverId);
                } else {
                    emailMap.set(log.user_email, { lastSeen: log.timestamp, serverIds: new Set([serverId]) });
                }
            }
        }

        const userByEmail = new Map<string, ClerkUser>();
        for (const u of p.users ?? []) userByEmail.set(getPrimaryEmail(u), u);

        return [...emailMap.entries()]
            .map(([email, { lastSeen, serverIds }]) => ({
                user: userByEmail.get(email) ?? null,
                email,
                lastSeen,
                serverIds: [...serverIds],
            }))
            .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    });

    const serverLabel = createMemo(() => {
        const map = new Map<string, string>();
        for (const s of p.servers ?? []) map.set(s.id, s.label);
        return map;
    });

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 560px">
                <div class="modal-header">
                    <h2>Currently Active Users</h2>
                    <button class="modal-close" onClick={p.onClose}>✕</button>
                </div>
                <div class="modal-body">
                    <p style="color: #94a3b8; font-size: 13px; margin-bottom: 16px">
                        Users active in the last 30 minutes ({activeUsers().length} online)
                    </p>
                    <Show
                        when={p.userLogs}
                        fallback={<p style="color: #94a3b8">Loading user logs...</p>}
                    >
                        <Show
                            when={activeUsers().length > 0}
                            fallback={<p style="color: #94a3b8">No users currently active.</p>}
                        >
                            <div style="max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px">
                                <For each={activeUsers()}>
                                    {(au) => (
                                        <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: rgba(255,255,255,0.04); border-radius: 8px">
                                            <Show when={au.user?.image_url}>
                                                <img
                                                    src={au.user!.image_url}
                                                    alt=""
                                                    style="width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0"
                                                />
                                            </Show>
                                            <div style="flex: 1; min-width: 0">
                                                <div style="color: #fff; font-weight: 500">
                                                    {au.user ? [au.user.first_name, au.user.last_name].filter(Boolean).join(' ') || au.email : au.email}
                                                </div>
                                                <div style="color: #94a3b8; font-size: 12px; display: flex; gap: 8px; flex-wrap: wrap">
                                                    <span>{au.email}</span>
                                                    <span>·</span>
                                                    <span>{au.serverIds.map(id => serverLabel().get(id) ?? id).join(', ')}</span>
                                                </div>
                                            </div>
                                            <div style="color: #22c55e; font-size: 12px; white-space: nowrap; display: flex; align-items: center; gap: 4px">
                                                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e" />
                                                {timeAgo(au.lastSeen)}
                                            </div>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </Show>
                </div>
            </div>
        </div>
    );
}
