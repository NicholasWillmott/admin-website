import { createMemo, For, Show } from 'solid-js';
import type { Server, ServerStatuses } from '../../types.ts';

interface AllServersActivityModalProps {
    servers: Server[] | undefined;
    statuses: ServerStatuses | undefined;
    onClose: () => void;
}

function timeAgo(timestamp: string): string {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    if (mins < 60) return `${mins} mins ago`;
    const hours = Math.floor(mins / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
}

interface ServerActivity {
    server: Server;
    lastSeen: string | null;
    lastUser: string | null;
    running: boolean;
}

export function AllServersActivityModal(p: AllServersActivityModalProps) {
    const sortedServers = createMemo((): ServerActivity[] => {
        return (p.servers ?? [])
            .map((server) => {
                const status = p.statuses?.[server.id];
                return {
                    server,
                    lastSeen: status?.lastUserLog?.timestamp ?? null,
                    lastUser: status?.lastUserLog?.userEmail ?? null,
                    running: status?.running ?? false,
                };
            })
            .sort((a, b) => {
                if (a.lastSeen && b.lastSeen) return b.lastSeen.localeCompare(a.lastSeen);
                if (a.lastSeen) return -1;
                if (b.lastSeen) return 1;
                if (a.running !== b.running) return a.running ? -1 : 1;
                return a.server.label.localeCompare(b.server.label);
            });
    });

    const isRecent = (timestamp: string | null) => {
        if (!timestamp) return false;
        return Date.now() - new Date(timestamp).getTime() < 30 * 60 * 1000;
    };

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 560px">
                <div class="modal-header">
                    <h2>Server Activity</h2>
                    <button class="modal-close" onClick={p.onClose}>✕</button>
                </div>
                <div class="modal-body">
                    <p style="color: #94a3b8; font-size: 13px; margin-bottom: 16px">
                        {sortedServers().filter(s => isRecent(s.lastSeen)).length} of {sortedServers().length} servers active in the last 30 minutes
                    </p>
                    <Show
                        when={p.statuses}
                        fallback={<p style="color: #94a3b8">Loading...</p>}
                    >
                        <div style="max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px">
                            <For each={sortedServers()}>
                                {(sa) => {
                                    const recent = isRecent(sa.lastSeen);
                                    return (
                                        <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: rgba(255,255,255,0.04); border-radius: 8px">
                                            <div style="flex: 1; min-width: 0">
                                                <div style="color: #fff; font-weight: 500">
                                                    {sa.server.label}
                                                    <span style="color: #64748b; font-size: 12px; margin-left: 6px">({sa.server.id})</span>
                                                </div>
                                                <div style="color: #94a3b8; font-size: 12px">
                                                    {sa.lastUser
                                                        ? `Last user: ${sa.lastUser}`
                                                        : sa.running ? 'No recent activity' : 'Offline'}
                                                </div>
                                            </div>
                                            <div style={`font-size: 12px; white-space: nowrap; display: flex; align-items: center; gap: 4px; color: ${recent ? '#22c55e' : sa.running ? '#94a3b8' : '#ef4444'}`}>
                                                <span style={`display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${recent ? '#22c55e' : sa.running ? '#94a3b8' : '#ef4444'}`} />
                                                {sa.lastSeen ? timeAgo(sa.lastSeen) : sa.running ? 'idle' : 'offline'}
                                            </div>
                                        </div>
                                    );
                                }}
                            </For>
                        </div>
                    </Show>
                </div>
            </div>
        </div>
    );
}
