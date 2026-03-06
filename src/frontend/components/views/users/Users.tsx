import { For, createSignal } from 'solid-js';
import type { ClerkUser, ClerkSession, Server, HealthCheckResponse } from "../../../types.ts";
import { formatDate } from '../../../utils.ts';
import { UserSessionsModal } from '../../modals/UserSessionsModal.tsx';
import { UserActivityGraph } from './graphs/UserActivityGraph.tsx';
import { UserRegistrationsGraph } from './graphs/UserRegistrationsGraph.tsx';
import { SignInHeatmap } from './graphs/SignInHeatmap.tsx';

interface UsersProps {
    users: ClerkUser[] | undefined;
    loading: boolean;
    error: Error | undefined;
    onFetchSessions: (userId: string) => Promise<ClerkSession[]>;
    servers: Server[] | undefined;
    onFetchInstanceStatus: (serverId: string) => Promise<HealthCheckResponse | null>;
}

function getPrimaryEmail(user: ClerkUser): string {
    const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
    return primary?.email_address ?? '—';
}

function formatUnixDate(ms: number | null): string {
    if (!ms) return 'Never';
    return formatDate(new Date(ms).toISOString());
}

type SortKey = 'created_at' | 'last_sign_in_at' | 'role' | 'emailOptIn';
type SortDir = 'asc' | 'desc';

export function Users(p: UsersProps) {
    const [selectedUser, setSelectedUser] = createSignal<ClerkUser | null>(null);
    const [sortKey, setSortKey] = createSignal<SortKey>('created_at');
    const [sortDir, setSortDir] = createSignal<SortDir>('desc');
    const [selectedInstance, setSelectedInstance] = createSignal<string | null>(null);
    const [instanceEmails, setInstanceEmails] = createSignal<Set<string>>(new Set());
    const [instanceAdminEmails, setInstanceAdminEmails] = createSignal<Set<string>>(new Set());
    const [instanceLoading, setInstanceLoading] = createSignal(false);
    const [selectedDomain, setSelectedDomain] = createSignal<string | null>(null);

    const availableDomains = () => {
        if (!p.users) return [];
        const domains = new Set<string>();
        for (const u of p.users) {
            const email = getPrimaryEmail(u);
            const at = email.indexOf('@');
            if (at !== -1) domains.add(email.slice(at + 1));
        }
        return [...domains].sort();
    };

    function toggleSort(key: SortKey) {
        if (sortKey() === key) {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    }

    async function selectInstance(serverId: string | null) {
        setSelectedInstance(serverId);
        if (!serverId) {
            setInstanceEmails(new Set<string>());
            setInstanceAdminEmails(new Set<string>());
            return;
        }
        setInstanceLoading(true);
        const status = await p.onFetchInstanceStatus(serverId);
        if (status) {
            const emails: string[] = status.serverUsers ?? status.adminUsers ?? [];
            setInstanceEmails(new Set<string>(emails));
            setInstanceAdminEmails(new Set<string>(status.adminUsers ?? []));
        } else {
            setInstanceEmails(new Set<string>());
            setInstanceAdminEmails(new Set<string>());
        }
        setInstanceLoading(false);
    }

    function downloadOptInCsv() {
        if (!p.users) return;
        const optedIn = p.users.filter(u => u.unsafe_metadata.emailOptIn === true);
        const rows = [['Name', 'Email']];
        for (const u of optedIn) {
            const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '-';
            rows.push([name, getPrimaryEmail(u)]);
        }
        const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'email-opt-in.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadAskedNotOptinCsv() {
        if (!p.users) return;
        const askedNotOptedIn = p.users.filter(u => (u.unsafe_metadata.emailOptIn === false && u.unsafe_metadata.emailOptInAsked === true));
        const rows =[['Name', 'Email']];
        for (const u of askedNotOptedIn) {
            const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '-';
            rows.push([name, getPrimaryEmail(u)]);
        }
        const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'email-opt-out.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    const sortedUsers = () => {
        if (!p.users) return [];
        const key = sortKey();
        const dir = sortDir();
        const emailFilter = instanceEmails();
        const filtering = selectedInstance() !== null;

        const domain = selectedDomain();

        const filtered = p.users.filter(u => {
            const email = getPrimaryEmail(u);
            if (filtering && !emailFilter.has(email)) return false;
            if (domain && !email.endsWith(`@${domain}`)) return false;
            return true;
        });

        return [...filtered].sort((a, b) => {
            if (key === 'role') {
                const aAdmin = a.public_metadata.isAdmin === true ? 1 : 0;
                const bAdmin = b.public_metadata.isAdmin === true ? 1 : 0;
                return dir === 'desc' ? bAdmin - aAdmin : aAdmin - bAdmin;
            }
            if (key === 'emailOptIn') {
                const aOpt = a.unsafe_metadata.emailOptIn === true ? 1 : 0;
                const bOpt = b.unsafe_metadata.emailOptIn === true ? 1 : 0;
                return dir === 'desc' ? bOpt - aOpt : aOpt - bOpt;
            }
            const aVal = a[key] ?? 0;
            const bVal = b[key] ?? 0;
            return dir === 'desc' ? bVal - aVal : aVal - bVal;
        });
    };

    return (
        <>
            <div class="users-container">
                <div class="users-content">
                    <div class="users-header">
                        <h2 class="users-title">Users ({sortedUsers().length}{selectedInstance() ? ` of ${p.users?.length ?? 0}` : ''})</h2>
                        <div class="users-header-controls">
                            {instanceLoading() && <div class="spinner spinner-sm"></div>}
                            <div class="dropdown">
                                <button type="button" class="activity-btn">Actions ▾</button>
                                <div class="dropdown-menu">
                                    <button type="button" class="dropdown-item" onClick={downloadOptInCsv}>
                                        Generate Mailing List
                                    </button>
                                    <button type="button" class="dropdown-item" onClick={downloadAskedNotOptinCsv}>
                                        Generate Opt-out List
                                    </button>
                                </div>
                            </div>
                            <select
                                class="instance-filter-select"
                                onChange={(e: { currentTarget: { value: string } }) => setSelectedDomain(e.currentTarget.value || null)}
                            >
                                <option value="">All Domains</option>
                                <For each={availableDomains()}>
                                    {(d: string) => <option value={d}>{d}</option>}
                                </For>
                            </select>
                            <select
                                class="instance-filter-select"
                                onChange={(e: { currentTarget: { value: string } }) => selectInstance(e.currentTarget.value || null)}
                            >
                                <option value="">All Instances</option>
                                <For each={p.servers}>
                                    {(s) => <option value={s.id}>{s.label}</option>}
                                </For>
                            </select>
                        </div>
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
                                        <th class="th-sortable" onClick={() => toggleSort('role')}>
                                            Role {sortKey() === 'role' ? (sortDir() === 'desc' ? '↓' : '↑') : '↕'}
                                        </th>
                                        <th class="th-sortable" onClick={() => toggleSort('created_at')}>
                                            Joined {sortKey() === 'created_at' ? (sortDir() === 'desc' ? '↓' : '↑') : '↕'}
                                        </th>
                                        <th class="th-sortable" onClick={() => toggleSort('last_sign_in_at')}>
                                            Last Sign In {sortKey() === 'last_sign_in_at' ? (sortDir() === 'desc' ? '↓' : '↑') : '↕'}
                                        </th>
                                        <th class="th-sortable" onClick={() => toggleSort('emailOptIn')}>
                                            Email Opt-In {sortKey() === 'emailOptIn' ? (sortDir() === 'desc' ? '↓' : '↑') : '↕'}
                                        </th>
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
                                                    <div class="role-badges">
                                                        {user.public_metadata.isAdmin === true && (
                                                            <span class="badge">Super Admin</span>
                                                        )}
                                                        {selectedInstance() && instanceAdminEmails().has(getPrimaryEmail(user)) && (
                                                            <span class="badge badge-instance">Instance Admin</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td class="user-date">{formatUnixDate(user.created_at)}</td>
                                                <td class="user-date">{formatUnixDate(user.last_sign_in_at)}</td>
                                                <td class="user-opt-in">
                                                    <span class={user.unsafe_metadata.emailOptIn === true ? 'opt-in-yes' : 'opt-in-no'}>
                                                        {user.unsafe_metadata.emailOptIn === true ? '✓' : '✗'}
                                                    </span>
                                                </td>
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

                    <UserActivityGraph users={p.users} />
                    <UserRegistrationsGraph users={p.users} />
                    <SignInHeatmap users={p.users} onFetchSessions={p.onFetchSessions} />
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
