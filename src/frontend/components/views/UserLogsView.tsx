import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Server, ServerUserLogs, ServerUserLogsAggregate } from '../../types.ts';
import { formatDate } from '../../utils.ts';

interface UserLogsViewProps {
    servers: Server[] | undefined;
    aggregateLogs: ServerUserLogsAggregate | undefined;
    aggregateLoading: boolean;
    rawLogs: ServerUserLogs | undefined;
    rawLoading: boolean;
}

type SortKey = 'week_start' | 'user_email' | 'endpoint' | 'project_id' | 'count';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 100;

export function UserLogsView(props: UserLogsViewProps) {
    const [mode, setMode] = createSignal<'aggregate' | 'raw'>('aggregate');
    const [dateFrom, setDateFrom] = createSignal('');
    const [dateTo, setDateTo] = createSignal('');
    const [selectedServerId, setSelectedServerId] = createSignal('');
    const [userSearch, setUserSearch] = createSignal('');
    const [endpointSearch, setEndpointSearch] = createSignal('');
    const [sortKey, setSortKey] = createSignal<SortKey>('week_start');
    const [sortDir, setSortDir] = createSignal<SortDir>('desc');
    const [aggPage, setAggPage] = createSignal(1);
    const [rawPage, setRawPage] = createSignal(1);

    const serverLabel = (id: string) =>
        props.servers?.find(s => s.id === id)?.label ?? id;

    function setFilter<T>(setter: (v: T) => void) {
        return (v: T) => { setter(v); setAggPage(1); setRawPage(1); };
    }

    function toggleSort(key: SortKey) {
        if (sortKey() === key) {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
        setAggPage(1);
    }

    function sortIndicator(key: SortKey) {
        if (sortKey() !== key) return ' ↕';
        return sortDir() === 'desc' ? ' ↓' : ' ↑';
    }

    const aggregateRows = createMemo(() => {
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

    const rawRows = createMemo(() => {
        const logs = props.rawLogs ?? {};
        const from = dateFrom() ? new Date(dateFrom()).getTime() : null;
        const to = dateTo() ? new Date(dateTo() + 'T23:59:59').getTime() : null;
        const serverId = selectedServerId();
        const userQ = userSearch().toLowerCase().trim();
        const endpointQ = endpointSearch().toLowerCase().trim();

        const entries: { serverId: string; user_email: string; endpoint: string; timestamp: string; project_id?: string }[] = [];

        for (const [sid, serverLogs] of Object.entries(logs)) {
            if (serverId && sid !== serverId) continue;
            for (const log of serverLogs) {
                const t = new Date(log.timestamp).getTime();
                if (from !== null && t < from) continue;
                if (to !== null && t > to) continue;
                if (userQ && !log.user_email.toLowerCase().includes(userQ)) continue;
                if (endpointQ && !log.endpoint.toLowerCase().includes(endpointQ)) continue;
                entries.push({ serverId: sid, ...log });
            }
        }

        return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    });

    const aggTotalPages = createMemo(() => Math.max(1, Math.ceil(aggregateRows().length / PAGE_SIZE)));
    const rawTotalPages = createMemo(() => Math.max(1, Math.ceil(rawRows().length / PAGE_SIZE)));

    const pagedAggRows = createMemo(() => {
        const p = Math.min(aggPage(), aggTotalPages());
        return aggregateRows().slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    });
    const pagedRawRows = createMemo(() => {
        const p = Math.min(rawPage(), rawTotalPages());
        return rawRows().slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    });

    const totalCount = createMemo(() => aggregateRows().reduce((sum, r) => sum + r.count, 0));
    const isLoading = () => mode() === 'aggregate' ? props.aggregateLoading : props.rawLoading;
    const isEmpty = () => mode() === 'aggregate' ? aggregateRows().length === 0 : rawRows().length === 0;

    function Pagination(p: { page: () => number; totalPages: () => number; setPage: (n: number) => void; total: number }) {
        return (
            <div class="logs-pagination">
                <button
                    class="logs-page-btn"
                    disabled={p.page() <= 1}
                    onClick={() => p.setPage(1)}
                >⇤</button>
                <button
                    class="logs-page-btn"
                    disabled={p.page() <= 1}
                    onClick={() => p.setPage(p.page() - 1)}
                >←</button>
                <span class="logs-page-info">
                    Page {p.page()} of {p.totalPages()} · {p.total.toLocaleString()} rows
                </span>
                <button
                    class="logs-page-btn"
                    disabled={p.page() >= p.totalPages()}
                    onClick={() => p.setPage(p.page() + 1)}
                >→</button>
                <button
                    class="logs-page-btn"
                    disabled={p.page() >= p.totalPages()}
                    onClick={() => p.setPage(p.totalPages())}
                >⇥</button>
            </div>
        );
    }

    return (
        <div class="ai-usage-container">
            <div class="ai-usage-content">
                <div class="ai-usage-header">
                    <div class="ai-usage-header-left">
                        <h2 class="ai-usage-title">
                            {mode() === 'aggregate'
                                ? `Usage Logs (${aggregateRows().length.toLocaleString()} rows · ${totalCount().toLocaleString()} events)`
                                : `Raw Logs (${rawRows().length.toLocaleString()})`
                            }
                        </h2>
                        <div class="ai-usage-view-toggle">
                            <button
                                class={`ai-usage-toggle-btn ${mode() === 'aggregate' ? 'active' : ''}`}
                                onClick={() => setMode('aggregate')}
                            >Aggregate</button>
                            <button
                                class={`ai-usage-toggle-btn ${mode() === 'raw' ? 'active' : ''}`}
                                onClick={() => setMode('raw')}
                            >Raw</button>
                        </div>
                    </div>
                    <div class="ai-usage-filters">
                        <input
                            type="date"
                            class="server-filter-input"
                            value={dateFrom()}
                            onChange={e => setFilter(setDateFrom)(e.currentTarget.value)}
                        />
                        <span class="ai-usage-filter-sep">to</span>
                        <input
                            type="date"
                            class="server-filter-input"
                            value={dateTo()}
                            onChange={e => setFilter(setDateTo)(e.currentTarget.value)}
                        />
                        <select
                            class="instance-filter-select"
                            onChange={e => setFilter(setSelectedServerId)(e.currentTarget.value)}
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
                            onInput={e => setFilter(setUserSearch)(e.currentTarget.value)}
                        />
                        <input
                            type="text"
                            class="server-filter-input"
                            placeholder="Filter by endpoint..."
                            value={endpointSearch()}
                            onInput={e => setFilter(setEndpointSearch)(e.currentTarget.value)}
                        />
                    </div>
                </div>

                <Show when={isLoading()}>
                    <div class="ai-usage-loading">
                        <div class="spinner" />
                        <p>Loading usage logs...</p>
                    </div>
                </Show>

                <Show when={!isLoading() && isEmpty()}>
                    <div class="ai-usage-empty">
                        <p>No log entries match the current filters.</p>
                    </div>
                </Show>

                <Show when={!isLoading() && !isEmpty()}>
                    <div class="logs-table-container">

                        {/* Aggregate table */}
                        <Show when={mode() === 'aggregate'}>
                            <table class="ai-usage-table logs-text-table">
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
                                    <For each={pagedAggRows()}>
                                        {log => (
                                            <tr>
                                                <td class="logs-td-time">{log.week_start}</td>
                                                <td class="logs-td-server">{serverLabel(log.serverId)}</td>
                                                <td class="logs-td-email">{log.user_email}</td>
                                                <td class="logs-td-endpoint">{log.endpoint}</td>
                                                <td class="logs-td-result">
                                                    <span class={`logs-result-pill ${log.endpoint_result === 'success' ? 'success' : log.endpoint_result === 'error' ? 'error' : 'neutral'}`}>
                                                        {log.endpoint_result}
                                                    </span>
                                                </td>
                                                <td class="logs-td-project">{log.project_id ?? '—'}</td>
                                                <td class="ai-usage-num">{log.count.toLocaleString()}</td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                            <Pagination
                                page={aggPage}
                                totalPages={aggTotalPages}
                                setPage={setAggPage}
                                total={aggregateRows().length}
                            />
                        </Show>

                        {/* Raw table */}
                        <Show when={mode() === 'raw'}>
                            <table class="ai-usage-table logs-text-table">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Server</th>
                                        <th>User</th>
                                        <th>Endpoint</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <For each={pagedRawRows()}>
                                        {log => (
                                            <tr>
                                                <td class="logs-td-time">{formatDate(log.timestamp)}</td>
                                                <td class="logs-td-server">{serverLabel(log.serverId)}</td>
                                                <td class="logs-td-email">{log.user_email}</td>
                                                <td class="logs-td-endpoint">{log.endpoint}</td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                            <Pagination
                                page={rawPage}
                                totalPages={rawTotalPages}
                                setPage={setRawPage}
                                total={rawRows().length}
                            />
                        </Show>

                    </div>
                </Show>
            </div>
        </div>
    );
}
