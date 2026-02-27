import { createResource, For } from 'solid-js';
import type { ClerkUser, ClerkSession } from '../../types.ts';

interface UserSessionsModalProps {
    user: ClerkUser;
    onClose: () => void;
    onFetchSessions: (userId: string) => Promise<ClerkSession[]>;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CELL_STRIDE = 13; // 11px cell + 2px gap

function generateWeeks(year: number): (Date | null)[][] {
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);

    const start = new Date(jan1);
    start.setDate(jan1.getDate() - jan1.getDay()); // back to Sunday

    const weeks: (Date | null)[][] = [];
    const current = new Date(start);

    while (current <= dec31) {
        const week: (Date | null)[] = [];
        for (let d = 0; d < 7; d++) {
            const day = new Date(current);
            week.push(day.getFullYear() === year ? day : null);
            current.setDate(current.getDate() + 1);
        }
        weeks.push(week);
    }

    return weeks;
}

function toLocalDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getActiveDays(sessions: ClerkSession[]): Set<string> {
    const days = new Set<string>();
    for (const session of sessions) {
        days.add(toLocalDateStr(new Date(session.last_active_at)));
        days.add(toLocalDateStr(new Date(session.created_at)));
    }
    return days;
}

function getMonthLabels(weeks: (Date | null)[][]): { label: string; left: number }[] {
    const labels: { label: string; left: number }[] = [];
    let lastMonth = -1;

    weeks.forEach((week, i) => {
        const firstDay = week.find(d => d !== null);
        if (firstDay) {
            const month = firstDay.getMonth();
            if (month !== lastMonth) {
                labels.push({ label: MONTH_NAMES[month], left: i * CELL_STRIDE });
                lastMonth = month;
            }
        }
    });

    return labels;
}

function getPrimaryEmail(user: ClerkUser): string {
    return user.email_addresses.find(e => e.id === user.primary_email_address_id)?.email_address ?? '';
}

export function UserSessionsModal(p: UserSessionsModalProps) {
    const year = new Date().getFullYear();
    const weeks = generateWeeks(year);
    const monthLabels = getMonthLabels(weeks);
    const today = toLocalDateStr(new Date());

    const [sessions] = createResource(() => p.onFetchSessions(p.user.id));

    const activeDays = () => {
        const s = sessions();
        if (!s) return new Set<string>();
        return getActiveDays(s);
    };

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div class="modal-content sessions-modal-content" onClick={(e) => e.stopPropagation()}>
                <div class="modal-header">
                    <div class="sessions-modal-user">
                        <img class="user-avatar" src={p.user.image_url} alt={p.user.first_name ?? 'User'} />
                        <div>
                            <h2>{p.user.first_name} {p.user.last_name}</h2>
                            <span class="sessions-modal-email">{getPrimaryEmail(p.user)}</span>
                        </div>
                    </div>
                    <button class="modal-close" onClick={p.onClose}>×</button>
                </div>

                <div class="modal-body">
                    {sessions.loading ? (
                        <div class="sessions-loading">
                            <div class="spinner"></div>
                            <p>Loading sessions...</p>
                        </div>
                    ) : (
                        <>
                            <div class="sessions-stats-row">
                                <div class="stat-item">
                                    <span class="stat-label">Total Sessions</span>
                                    <span class="stat-value">{sessions()?.length ?? 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Active Days ({year})</span>
                                    <span class="stat-value">{activeDays().size}</span>
                                </div>
                            </div>

                            <p class="heatmap-year-label">{year} Activity</p>

                            <div class="heatmap-container">
                                <div class="heatmap-day-labels">
                                    <For each={DAY_LABELS}>
                                        {(label) => (
                                            <span class="heatmap-day-label">{label}</span>
                                        )}
                                    </For>
                                </div>

                                <div class="heatmap-right">
                                    <div class="heatmap-grid">
                                        <For each={weeks}>
                                            {(week) => (
                                                <div class="heatmap-week">
                                                    <For each={week}>
                                                        {(day) => {
                                                            if (!day) return <div class="heatmap-cell empty" />;
                                                            const dateStr = toLocalDateStr(day);
                                                            const isActive = activeDays().has(dateStr);
                                                            const isToday = dateStr === today;
                                                            return (
                                                                <div
                                                                    class={`heatmap-cell${isActive ? ' active' : ''}${isToday ? ' today' : ''}`}
                                                                    title={dateStr}
                                                                />
                                                            );
                                                        }}
                                                    </For>
                                                </div>
                                            )}
                                        </For>
                                    </div>

                                    <div class="heatmap-month-row">
                                        <For each={monthLabels}>
                                            {(m) => (
                                                <span class="heatmap-month-label" style={{ left: `${m.left}px` }}>
                                                    {m.label}
                                                </span>
                                            )}
                                        </For>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
