import { For, Show, createResource, createSignal } from 'solid-js';
import type { Server, PgStatStatementsOrderBy, PgStatStatement } from '../../types.ts';
import { fetchServerPgStatStatements, resetServerPgStatStatements } from '../../services.ts';

interface PgStatStatementsViewProps {
  servers: Server[] | undefined;
  getToken: () => Promise<string | null>;
}

function formatMs(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 60000) return `${(n / 60000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  if (n >= 1) return `${n.toFixed(1)}ms`;
  return `${n.toFixed(2)}ms`;
}

function formatNum(s: string | number): string {
  const n = typeof s === 'string' ? Number(s) : s;
  if (!Number.isFinite(n)) return String(s);
  return n.toLocaleString();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

export function PgStatStatementsView(props: PgStatStatementsViewProps) {
  const [serverId, setServerId] = createSignal<string>('');
  const [orderBy, setOrderBy] = createSignal<PgStatStatementsOrderBy>('total');
  const [limit, setLimit] = createSignal<number>(50);
  const [minMeanMs, setMinMeanMs] = createSignal<number>(0);
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const [search, setSearch] = createSignal<string>('');
  const [resetting, setResetting] = createSignal(false);

  const [data, { refetch }] = createResource(
    () => {
      const id = serverId();
      if (!id) return null;
      return { id, orderBy: orderBy(), limit: limit(), minMeanMs: minMeanMs() };
    },
    async (params) => {
      if (!params) return null;
      const token = await props.getToken();
      return fetchServerPgStatStatements(params.id, token, {
        orderBy: params.orderBy,
        limit: params.limit,
        minMeanMs: params.minMeanMs,
      });
    },
  );

  const sortedServers = () => [...(props.servers ?? [])].sort((a, b) =>
    a.label.localeCompare(b.label)
  );

  const filtered = () => {
    const stmts = data()?.statements ?? [];
    const q = search().toLowerCase();
    return q ? stmts.filter((s) => s.query.toLowerCase().includes(q)) : stmts;
  };

  return (
    <div class="pgss-container">
      <div class="pgss-content">
        <div class="pgss-header">
          <h2 class="pgss-title">Postgres Statements</h2>
          <div class="pgss-filters">
            <select
              class="server-filter-select"
              value={serverId()}
              onChange={(e) => setServerId(e.currentTarget.value)}
            >
              <option value="">Select server...</option>
              <For each={sortedServers()}>
                {(s) => <option value={s.id}>{s.label}</option>}
              </For>
            </select>
            <select
              class="server-filter-select"
              value={orderBy()}
              onChange={(e) => setOrderBy(e.currentTarget.value as PgStatStatementsOrderBy)}
            >
              <option value="total">Order: total time</option>
              <option value="mean">Order: mean time</option>
              <option value="max">Order: max time</option>
              <option value="calls">Order: calls</option>
            </select>
            <input
              type="number"
              class="server-filter-input"
              min="1"
              max="500"
              value={limit()}
              onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.currentTarget.value) || 50)))}
              title="Limit"
            />
            <input
              type="number"
              class="server-filter-input"
              min="0"
              step="any"
              value={minMeanMs()}
              onChange={(e) => setMinMeanMs(Math.max(0, Number(e.currentTarget.value) || 0))}
              title="Min mean ms"
              placeholder="min mean ms"
            />
            <input
              type="search"
              class="server-filter-input"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search queries…"
            />
            <button class="system-btn" disabled={!serverId() || data.loading} onClick={() => refetch()}>
              {data.loading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              class="system-btn system-btn--danger"
              disabled={!serverId() || resetting()}
              onClick={async () => {
                if (!confirm('Reset pg_stat_statements for this server? This clears all accumulated query stats.')) return;
                setResetting(true);
                try {
                  const token = await props.getToken();
                  await resetServerPgStatStatements(serverId(), token);
                  await refetch();
                } finally {
                  setResetting(false);
                }
              }}
            >
              {resetting() ? 'Resetting…' : 'Reset Stats'}
            </button>
          </div>
        </div>

        <Show when={!serverId()}>
          <div class="pgss-empty">
            <p>Select a server to view its top queries by execution time.</p>
          </div>
        </Show>

        <Show when={serverId() && data.loading}>
          <div class="pgss-loading">
            <div class="spinner" />
            <p>Loading pg_stat_statements…</p>
          </div>
        </Show>

        <Show when={serverId() && !data.loading && data.error}>
          <div class="pgss-error">
            <p>Error loading: {String(data.error)}</p>
          </div>
        </Show>

        <Show when={serverId() && !data.loading && !data.error && data() === null}>
          <div class="pgss-warning">
            <p>No data returned. The server may not have <code>pg_stat_statements</code> enabled yet.</p>
          </div>
        </Show>

        <Show when={data() && data()!.statements.length === 0}>
          <div class="pgss-empty">
            <p>No statements match the current filter.</p>
          </div>
        </Show>

        <Show when={data() && data()!.statements.length > 0}>
          <div class="pgss-meta">
            <span>Instance: <strong>{data()!.instanceName}</strong></span>
            <span>Server time: {new Date(data()!.serverTime).toLocaleString()}</span>
            <span>Rows: {filtered().length}{search() ? ` / ${data()!.statements.length}` : ''}</span>
          </div>
          <table class="pgss-table">
            <thead>
              <tr>
                <th>Database</th>
                <th>Calls</th>
                <th>Mean</th>
                <th>Max</th>
                <th>Total</th>
                <th>Rows</th>
                <th class="pgss-query-col">Query</th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()}>
                {(s: PgStatStatement) => {
                  const isExpanded = () => expanded() === s.queryid;
                  return (
                    <tr
                      class="pgss-row"
                      onClick={() => setExpanded(isExpanded() ? null : s.queryid)}
                    >
                      <td class="pgss-db">{s.datname ?? '—'}</td>
                      <td class="pgss-num">{formatNum(s.calls)}</td>
                      <td class="pgss-num">{formatMs(s.mean_exec_time_ms)}</td>
                      <td class="pgss-num">{formatMs(s.max_exec_time_ms)}</td>
                      <td class="pgss-num pgss-total">{formatMs(s.total_exec_time_ms)}</td>
                      <td class="pgss-num">{formatNum(s.rows)}</td>
                      <td class="pgss-query">
                        <code class={isExpanded() ? 'pgss-query-full' : 'pgss-query-clipped'}>
                          {isExpanded() ? s.query : truncate(s.query.replace(/\s+/g, ' '), 140)}
                        </code>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </div>
  );
}
