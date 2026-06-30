import { For, Show, createMemo, createSignal } from 'solid-js';
import type { AccessLogEntry } from '../../types.ts';
import { formatDate } from '../../utils.ts';

interface AccessLogViewProps {
  entries: AccessLogEntry[] | undefined;
  loading: boolean;
  error: Error | undefined;
  onRefetch: () => void;
}

const PAGE_SIZE = 100;

export function AccessLogView(props: AccessLogViewProps) {
  const [search, setSearch] = createSignal('');
  const [page, setPage] = createSignal(1);

  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase();
    const all = props.entries ?? [];
    if (!q) return all;
    return all.filter(e => e.email.toLowerCase().includes(q));
  });

  const uniqueVisitors = createMemo(() => new Set((props.entries ?? []).map(e => e.email)).size);

  const totalPages = createMemo(() => Math.max(1, Math.ceil(filtered().length / PAGE_SIZE)));
  const pageEntries = createMemo(() => {
    const start = (page() - 1) * PAGE_SIZE;
    return filtered().slice(start, start + PAGE_SIZE);
  });

  function onSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  return (
    <div class="volume-usage-container">
      <div class="volume-usage-content">
        <div class="volume-usage-header">
          <h2 class="volume-usage-title">Site Access Log</h2>
          <button class="system-btn" onClick={() => props.onRefetch()}>Refresh</button>
        </div>

        <Show when={props.loading}>
          <div class="volume-usage-loading">
            <div class="spinner"></div>
            <p>Loading access log...</p>
          </div>
        </Show>

        <Show when={!props.loading && props.error}>
          <div class="volume-usage-error">
            <p>Error loading access log: {props.error?.message}</p>
          </div>
        </Show>

        <Show when={!props.loading && !props.error}>
          <div class="access-log-toolbar">
            <input
              type="text"
              class="access-log-search"
              placeholder="Filter by email..."
              value={search()}
              onInput={(e) => onSearch(e.currentTarget.value)}
            />
            <span class="access-log-stats">
              {filtered().length} visit{filtered().length === 1 ? '' : 's'} · {uniqueVisitors()} unique user{uniqueVisitors() === 1 ? '' : 's'}
            </span>
          </div>

          <Show
            when={filtered().length > 0}
            fallback={<div class="volume-no-data"><p>No site visits recorded yet.</p></div>}
          >
            <table class="access-log-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>When</th>
                  <th>Browser</th>
                </tr>
              </thead>
              <tbody>
                <For each={pageEntries()}>
                  {(entry) => (
                    <tr>
                      <td class="access-log-email">{entry.email}</td>
                      <td class="access-log-time">{formatDate(entry.timestamp)}</td>
                      <td class="access-log-ua" title={entry.userAgent}>{entry.userAgent || '—'}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>

            <Show when={totalPages() > 1}>
              <div class="access-log-pagination">
                <button class="system-btn" disabled={page() <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  Previous
                </button>
                <span class="access-log-page-info">Page {page()} of {totalPages()}</span>
                <button class="system-btn" disabled={page() >= totalPages()} onClick={() => setPage(p => Math.min(totalPages(), p + 1))}>
                  Next
                </button>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
