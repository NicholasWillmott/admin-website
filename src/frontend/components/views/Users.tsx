import { For, createSignal } from 'solid-js';
import type { ClerkUser, ClerkSession } from "../../types.ts";
import { formatDate } from '../../utils.ts';
import { UserSessionsModal } from '../modals/UserSessionsModal.tsx';

interface UsersProps {
    users: ClerkUser[] | undefined;
    loading: boolean;
    error: Error | undefined;
    onFetchSessions: (userId: string) => Promise<ClerkSession[]>;
}

function getPrimaryEmail(user: ClerkUser): string {
    const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
    return primary?.email_address ?? '—';
}

function formatUnixDate(ms: number | null): string {
    if (!ms) return 'Never';
    return formatDate(new Date(ms).toISOString());
}

export function Users(p: UsersProps) {
    const [selectedUser, setSelectedUser] = createSignal<ClerkUser | null>(null);

    const sortedUsers = () => {
        if (!p.users) return [];
        return [...p.users].sort((a, b) => b.created_at - a.created_at);
    };

    return (
        <>
            <div class="users-container">
                <div class="users-content">
                    <div class="users-header">
                        <h2 class="users-title">Users ({p.users?.length ?? 0})</h2>
                    </div>

                    {p.loading ? (
                        <div class="users-loading">
                            <div class="spinner"></div>
                            <p>Loading Users</p>
                        </div>
                    ) : p.error ? (
                        <div class="users-error">
                            <p>Error loading users: {p.error.message}</p>
                        </div>
                    ) : sortedUsers().length === 0 ? (
                        <div class="users-empty">
                            <p>No users found</p>
                        </div>
                    ) : (
                        <div class="users-table-container">
                            <table class="users-table">
                                <thead>
                                    <tr>
                                        <th>User</th>
                                        <th>Email</th>
                                        <th>Role</th>
                                        <th>Joined</th>
                                        <th>Last Sign In</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={sortedUsers()}>
                                        {(user) => (
                                            <tr>
                                                <td class="user-cell">
                                                    <img
                                                        class="user-avatar"
                                                        src={user.image_url}
                                                        alt={user.first_name ?? 'User'}
                                                    />
                                                    <span class="user-name">
                                                        {user.first_name} {user.last_name}
                                                    </span>
                                                </td>
                                                <td class="user-email-cell">{getPrimaryEmail(user)}</td>
                                                <td>
                                                    {user.public_metadata.isAdmin === true && (
                                                        <span class="badge">Admin</span>
                                                    )}
                                                </td>
                                                <td class="user-date">{formatUnixDate(user.created_at)}</td>
                                                <td class="user-date">{formatUnixDate(user.last_sign_in_at)}</td>
                                                <td>
                                                    <button
                                                        type="button"
                                                        class="activity-btn"
                                                        onClick={() => setSelectedUser(user)}
                                                    >
                                                        Activity
                                                    </button>
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {selectedUser() && (
                <UserSessionsModal
                    user={selectedUser()!}
                    onClose={() => setSelectedUser(null)}
                    onFetchSessions={p.onFetchSessions}
                />
            )}
        </>
    );
}
