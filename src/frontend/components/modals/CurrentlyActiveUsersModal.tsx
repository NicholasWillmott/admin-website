import { createMemo, For, Show } from 'solid-js';
import type { ClerkUser, Server, ServerStatuses, ServerUserLogs } from '../../types.ts';

interface CurrentlyActiveUsersModalProps {
    users: ClerkUser[] | undefined;
    servers: Server[] | undefined;
    statuses: ServerStatuses | undefined;
    userLogs: ServerUserLogs | undefined;
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
    if (mins < 60) return `${mins} mins ago`;
    const hours = Math.floor(mins / 60);
    if (hours === 1) return '1 hour ago';
    return `${hours} hours ago`;
}

interface ActiveUser {
    user: ClerkUser | null;
    email: string;
    lastSeen: string;
    serverIds: string[];
}

export function CurrentlyActiveUsersModal(p: CurrentlyActiveUsersModalProps) {
    const activeUsers = createMemo((): ActiveUser[] => {
        const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
        const emailMap = new Map<string, { lastSeen: string; serverIds: Set<string> }>();

        const addEntry = (email: string, timestamp: string, serverId: string) => {
            if (new Date(timestamp).getTime() < thirtyMinsAgo) return;
            const existing = emailMap.get(email);
            if (existing) {
                if (timestamp > existing.lastSeen) existing.lastSeen = timestamp;
                existing.serverIds.add(serverId);
            } else {
                emailMap.set(email, { lastSeen: timestamp, serverIds: new Set([serverId]) });
            }
        };

        // Primary source: user_logs has all users with full timestamps
        if (p.userLogs) {
            for (const [serverId, logs] of Object.entries(p.userLogs)) {
                for (const log of logs) {
                    if (log.endpoint !== 'getCurrentUser') continue;
                    addEntry(log.user_email, log.timestamp, serverId);
                }
            }
        }

        // Secondary source: statuses.lastUserLog is real-time (refreshes every 60s)
        // but only has the single most recent user per server
        if (p.statuses) {
            for (const [serverId, status] of Object.entries(p.statuses)) {
                const log = status?.lastUserLog;
                if (log) addEntry(log.userEmail, log.timestamp, serverId);
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
                        when={p.statuses || p.userLogs}
                        fallback={<p style="color: #94a3b8">Loading...</p>}
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
