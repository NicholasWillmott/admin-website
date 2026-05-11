import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Server, ServerUserLogsAggregate } from '../../types.ts';

interface UserLogsViewProps {
    servers: Server[] | undefined;
    aggregateLogs: ServerUserLogsAggregate | undefined;
    loading: boolean;
}

type SortKey = 'week_start' | 'user_email' | 'endpoint' | 'project_id' | 'count';
type SortDir = 'asc' | 'desc';

export function UserLogsView(props: UserLogsViewProps) {
    const [dateFrom, setDateFrom] = createSignal('');
    const [dateTo, setDateTo] = createSignal('');
    const [selectedServerId, setSelectedServerId] = createSignal('');
    const [userSearch, setUserSearch] = createSignal('');
    const [endpointSearch, setEndpointSearch] = createSignal('');
    const [sortKey, setSortKey] = createSignal<SortKey>('week_start');
    const [sortDir, setSortDir] = createSignal<SortDir>('desc');

    const serverLabel = (id: string) =>
        props.servers?.find(s => s.id === id)?.label ?? id;

    function toggleSort(key: SortKey) {
        if (sortKey() === key) {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    }

    function sortIndicator(key: SortKey) {
        if (sortKey() !== key) return ' ↕';
        return sortDir() === 'desc' ? ' ↓' : ' ↑';
    }

    const flatLogs = createMemo(() => {
        const logs = props.aggregateLogs ?? {};
        const from = dateFrom() || null;
        const to = dateTo() || null;
        const serverId = selectedServerId();
        const userQ = userSearch().toLowerCase().trim();
        const endpointQ = endpointSearch().toLowerCase().trim();

        const entries: ({ serverId: string } & NonNullable<ServerUserLogsAggregate[string]>[number])[] = [];

        for (const [sid, serverLogs] of Object.entries(logs)) {
            if (serverId && sid !== serverId) continue;
            for (const log of serverLogs) {
                if (from && log.week_start < from) continue;
                if (to && log.week_start > to) continue;
                if (userQ && !log.user_email.toLowerCase().includes(userQ)) continue;
                if (endpointQ && !log.endpoint.toLowerCase().includes(endpointQ)) continue;
                entries.push({ serverId: sid, ...log });
            }
        }

        const key = sortKey();
        const dir = sortDir();
        return entries.sort((a, b) => {
            const av = key === 'count' ? a.count : (a[key] ?? '');
            const bv = key === 'count' ? b.count : (b[key] ?? '');
            if (av < bv) return dir === 'asc' ? -1 : 1;
            if (av > bv) return dir === 'asc' ? 1 : -1;
            return 0;
        });
    });

    const totalCount = createMemo(() => flatLogs().reduce((sum, r) => sum + r.count, 0));

    return (
        <div class="ai-usage-container">
            <div class="ai-usage-content">
                <div class="ai-usage-header">
                    <div class="ai-usage-header-left">
                        <h2 class="ai-usage-title">
                            Usage Logs ({flatLogs().length.toLocaleString()} rows · {totalCount().toLocaleString()} events)
                        </h2>
                    </div>
                    <div class="ai-usage-filters">
                        <input
                            type="date"
                            class="server-filter-input"
                            value={dateFrom()}
                            onChange={e => setDateFrom(e.currentTarget.value)}
                        />
                        <span class="ai-usage-filter-sep">to</span>
                        <input
                            type="date"
                            class="server-filter-input"
                            value={dateTo()}
                            onChange={e => setDateTo(e.currentTarget.value)}
                        />
                        <select
                            class="instance-filter-select"
                            onChange={e => setSelectedServerId(e.currentTarget.value)}
                        >
                            <option value="">All Servers</option>
                            <For each={props.servers}>
                                {s => <option value={s.id}>{s.label}</option>}
                            </For>
                        </select>
                        <input
                            type="text"
                            class="server-filter-input"
                            placeholder="Filter by user..."
                            value={userSearch()}
                            onInput={e => setUserSearch(e.currentTarget.value)}
                        />
                        <input
                            type="text"
                            class="server-filter-input"
                            placeholder="Filter by endpoint..."
                            value={endpointSearch()}
                            onInput={e => setEndpointSearch(e.currentTarget.value)}
                        />
                    </div>
                </div>

                <Show when={props.loading}>
                    <div class="ai-usage-loading">
                        <div class="spinner" />
                        <p>Loading usage logs...</p>
                    </div>
                </Show>

                <Show when={!props.loading && flatLogs().length === 0}>
                    <div class="ai-usage-empty">
                        <p>No log entries match the current filters.</p>
                    </div>
                </Show>

                <Show when={!props.loading && flatLogs().length > 0}>
                    <div class="logs-table-container">
                        <table class="ai-usage-table">
                            <thead>
                                <tr>
                                    <th class="th-sortable" onClick={() => toggleSort('week_start')}>
                                        Week{sortIndicator('week_start')}
                                    </th>
                                    <th>Server</th>
                                    <th class="th-sortable" onClick={() => toggleSort('user_email')}>
                                        User{sortIndicator('user_email')}
                                    </th>
                                    <th class="th-sortable" onClick={() => toggleSort('endpoint')}>
                                        Endpoint{sortIndicator('endpoint')}
                                    </th>
                                    <th>Result</th>
                                    <th class="th-sortable" onClick={() => toggleSort('project_id')}>
                                        Project{sortIndicator('project_id')}
                                    </th>
                                    <th class="th-sortable" onClick={() => toggleSort('count')}>
                                        Count{sortIndicator('count')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={flatLogs()}>
                                    {log => (
                                        <tr>
                                            <td class="logs-td-time">{log.week_start}</td>
                                            <td class="logs-td-server">{serverLabel(log.serverId)}</td>
                                            <td class="logs-td-email">{log.user_email}</td>
                                            <td class="logs-td-endpoint">{log.endpoint}</td>
                                            <td class="logs-td-result">{log.endpoint_result}</td>
                                            <td class="logs-td-project">{log.project_id ?? '—'}</td>
                                            <td class="ai-usage-num">{log.count.toLocaleString()}</td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </div>
        </div>
    );
}
