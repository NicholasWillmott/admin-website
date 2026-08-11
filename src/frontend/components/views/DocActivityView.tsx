import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Server, ServerUserLogsAggregate } from '../../types.ts';

const SESSION_ENDPOINTS: Record<string, 'report' | 'deck'> = {
    reportEditSession: 'report',
    deckEditSession: 'deck',
};

type KindFilter = 'all' | 'report' | 'deck';
type SortDir = 'asc' | 'desc';

interface DocActivityViewProps {
    servers: Server[] | undefined;
    aggregateLogs: ServerUserLogsAggregate | undefined;
    loading: boolean;
}

interface Cell {
    sessions: number;
    editors: Set<string>;
}

interface Row {
    server: Server;
    monthCells: (Cell | undefined)[];
    total: number;
    offline: boolean;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Edit-session tracking went live July 2026 — earlier months can never have entries,
// so don't show columns for them.
const TRACKING_START = '2026-07';

// Last n calendar months (UTC) as 'YYYY-MM', oldest first, ending at the current month
function lastMonths(n: number): string[] {
    const now = new Date();
    let y = now.getUTCFullYear();
    let m = now.getUTCMonth();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
        out.unshift(`${y}-${String(m + 1).padStart(2, '0')}`);
        m--;
        if (m < 0) { m = 11; y--; }
    }
    return out;
}

function monthLabel(month: string): string {
    return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} '${month.slice(2, 4)}`;
}

export function DocActivityView(props: DocActivityViewProps) {
    // 'YYYY-MM' strings compare correctly lexicographically
    const monthCols = lastMonths(13).filter(m => m >= TRACKING_START);
    const [kindFilter, setKindFilter] = createSignal<KindFilter>('all');
    const [sortKey, setSortKey] = createSignal<string>('total');
    const [sortDir, setSortDir] = createSignal<SortDir>('asc');

    function toggleSort(key: string) {
        if (sortKey() === key) {
            setSortDir(d => d === 'desc' ? 'asc' : 'desc');
        } else {
            setSortKey(key);
            setSortDir(key === 'label' ? 'asc' : 'desc');
        }
    }

    function sortIndicator(key: string) {
        if (sortKey() !== key) return ' ↕';
        return sortDir() === 'desc' ? ' ↓' : ' ↑';
    }

    // serverId -> month -> {sessions, editors}, for the active kind filter
    const cells = createMemo(() => {
        const filter = kindFilter();
        const byServer = new Map<string, Map<string, Cell>>();
        for (const [sid, serverLogs] of Object.entries(props.aggregateLogs ?? {})) {
            for (const log of serverLogs ?? []) {
                const kind = SESSION_ENDPOINTS[log.endpoint];
                if (!kind) continue;
                if (filter !== 'all' && kind !== filter) continue;
                const month = log.week_start.slice(0, 7);
                let months = byServer.get(sid);
                if (!months) { months = new Map(); byServer.set(sid, months); }
                let cell = months.get(month);
                if (!cell) { cell = { sessions: 0, editors: new Set() }; months.set(month, cell); }
                cell.sessions += log.count;
                cell.editors.add(log.user_email);
            }
        }
        return byServer;
    });

    const rows = createMemo<Row[]>(() => {
        const logs = props.aggregateLogs ?? {};
        const c = cells();
        const list: Row[] = (props.servers ?? [])
            .filter(s => s.mode !== 'central')
            .map(server => {
                const offline = logs[server.id] === null;
                const serverCells = c.get(server.id);
                const monthCells = monthCols.map(m => serverCells?.get(m));
                const total = monthCells.reduce((sum, cell) => sum + (cell?.sessions ?? 0), 0);
                return { server, monthCells, total, offline };
            });

        const key = sortKey();
        const dir = sortDir();
        const monthIdx = monthCols.indexOf(key);
        const value = (r: Row): string | number => {
            if (key === 'label') return r.server.label.toLowerCase();
            if (monthIdx >= 0) return r.monthCells[monthIdx]?.sessions ?? 0;
            return r.total;
        };
        return list.sort((a, b) => {
            // Unreachable rows carry no signal — keep them at the bottom
            if (a.offline !== b.offline) return a.offline ? 1 : -1;
            const av = value(a);
            const bv = value(b);
            if (av < bv) return dir === 'asc' ? -1 : 1;
            if (av > bv) return dir === 'asc' ? 1 : -1;
            return a.server.label.localeCompare(b.server.label);
        });
    });

    function exportCsv() {
        const header = ['Instance', ...monthCols, 'Total'];
        const lines = [header, ...rows().map(r => [
            r.server.label,
            ...r.monthCells.map(cell => r.offline ? 'n/a' : String(cell?.sessions ?? 0)),
            r.offline ? 'n/a' : String(r.total),
        ])];
        const csv = lines.map(row => row.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
        // UTF-8 BOM so Excel reads accented instance labels correctly
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `doc-activity-${kindFilter()}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div class="ai-usage-container">
            <div class="ai-usage-content">
                <div class="ai-usage-header">
                    <div class="ai-usage-header-left">
                        <h2 class="ai-usage-title">Report & Deck Activity</h2>
                        <div class="ai-usage-view-toggle">
                            <button
                                class={`ai-usage-toggle-btn ${kindFilter() === 'all' ? 'active' : ''}`}
                                onClick={() => setKindFilter('all')}
                            >All</button>
                            <button
                                class={`ai-usage-toggle-btn ${kindFilter() === 'report' ? 'active' : ''}`}
                                onClick={() => setKindFilter('report')}
                            >Reports</button>
                            <button
                                class={`ai-usage-toggle-btn ${kindFilter() === 'deck' ? 'active' : ''}`}
                                onClick={() => setKindFilter('deck')}
                            >Decks</button>
                        </div>
                    </div>
                    <button class="doc-activity-export-btn" onClick={exportCsv}>
                        Export CSV
                    </button>
                </div>

                <p class="doc-activity-note">
                    Editing sessions per instance per month (one session = one user's continuous
                    editing stint on a report or slide deck). Internal team activity is excluded.
                </p>

                <Show when={props.loading}>
                    <div class="ai-usage-loading">
                        <div class="spinner" />
                        <p>Loading activity...</p>
                    </div>
                </Show>

                <Show when={!props.loading}>
                    <div class="logs-table-container">
                        <table class="ai-usage-table logs-text-table">
                            <thead>
                                <tr>
                                    <th class="th-sortable" onClick={() => toggleSort('label')}>
                                        Instance{sortIndicator('label')}
                                    </th>
                                    <For each={monthCols}>
                                        {m => (
                                            <th class="th-sortable doc-activity-th-month" onClick={() => toggleSort(m)}>
                                                {monthLabel(m)}{sortIndicator(m)}
                                            </th>
                                        )}
                                    </For>
                                    <th class="th-sortable" onClick={() => toggleSort('total')}>
                                        Total{sortIndicator('total')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={rows()}>
                                    {row => (
                                        <tr>
                                            <td class="doc-activity-instance">{row.server.label}</td>
                                            <For each={row.monthCells}>
                                                {cell => (
                                                    <Show
                                                        when={!row.offline}
                                                        fallback={
                                                            <td class="ai-usage-num doc-activity-cell-na" title="No data — instance unreachable">
                                                                n/a
                                                            </td>
                                                        }
                                                    >
                                                        <td
                                                            class={`ai-usage-num ${!cell?.sessions ? 'doc-activity-cell-zero' : ''}`}
                                                            title={cell ? `${cell.sessions} sessions · ${cell.editors.size} ${cell.editors.size === 1 ? 'editor' : 'editors'}` : '0 sessions'}
                                                        >
                                                            {cell?.sessions ?? 0}
                                                        </td>
                                                    </Show>
                                                )}
                                            </For>
                                            <Show
                                                when={!row.offline}
                                                fallback={
                                                    <td class="ai-usage-num doc-activity-cell-na" title="No data — instance unreachable">
                                                        n/a
                                                    </td>
                                                }
                                            >
                                                <td class={`ai-usage-num doc-activity-total ${row.total === 0 ? 'doc-activity-cell-zero' : ''}`}>
                                                    {row.total}
                                                </td>
                                            </Show>
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
