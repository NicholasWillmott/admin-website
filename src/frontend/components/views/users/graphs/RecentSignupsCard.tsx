import { For } from 'solid-js';
import type { ClerkUser } from '../../../../types.ts';

interface RecentSignupsCardProps {
    users: ClerkUser[] | undefined;
}

function getPrimaryEmail(user: ClerkUser): string {
    const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
    return primary?.email_address ?? '—';
}

function timeAgo(ms: number): string {
    const diff = Date.now() - ms;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

export function RecentSignupsCard(p: RecentSignupsCardProps) {
    const recent = () =>
        [...(p.users ?? [])]
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, 10);

    return (
        <div class="activity-graph-section">
            <div class="activity-graph-header">
                <div>
                    <span class="activity-graph-title">Recent Signups</span>
                    <span class="activity-graph-subtitle">(last 10 registrations)</span>
                </div>
            </div>

            <div class="recent-signups-list">
                <For each={recent()} fallback={
                    <p style={{ color: '#bbb', 'font-size': '13px', margin: '12px 0' }}>No users found</p>
                }>
                    {(user) => (
                        <div class="recent-signup-row">
                            <img class="user-avatar" src={user.image_url} alt={user.first_name ?? 'User'} />
                            <div class="recent-signup-info">
                                <span class="recent-signup-name">
                                    {user.first_name || user.last_name
                                        ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
                                        : '(no name)'}
                                </span>
                                <span class="recent-signup-email">{getPrimaryEmail(user)}</span>
                            </div>
                            <span class="recent-signup-time">{timeAgo(user.created_at)}</span>
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
}
