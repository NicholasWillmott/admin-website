import { For, Show, createMemo, createSignal } from 'solid-js';
import type { ChangelogVersion, SentEmailSummary } from '../../types.ts';
import { SentEmailViewModal } from '../modals/SentEmailViewModal.tsx';

type AudienceFilter = 'user' | 'admin' | 'emails';

interface ChangelogViewProps {
  changelog: { versions: ChangelogVersion[] } | undefined;
  loading: boolean;
  error: Error | undefined;
  emailHistory: SentEmailSummary[] | undefined;
  emailHistoryLoading: boolean;
  onRefetchEmails?: () => void;
  onViewEmail: (id: string, key: string) => Promise<string | null>;
}

export function ChangelogView(props: ChangelogViewProps) {
  const [filter, setFilter] = createSignal<AudienceFilter>('admin');
  const [viewingHtml, setViewingHtml] = createSignal<string | null>(null);
  const [loadingEmail, setLoadingEmail] = createSignal(false);
  const [dateFrom, setDateFrom] = createSignal('');
  const [dateTo, setDateTo] = createSignal('');
  const [instanceFilter, setInstanceFilter] = createSignal('');

  const filteredVersions = () => {
    const versions = props.changelog?.versions ?? [];
    return versions
      .map(v => ({
        ...v,
        types: v.types
          .map(t => ({ ...t, items: t.items.filter(i => i.audience === filter()) }))
          .filter(t => t.items.length > 0),
      }))
      .filter(v => v.types.length > 0);
  };

  const instanceOptions = createMemo(() => {
    const history = props.emailHistory ?? [];
    const instances = new Map<string, string>(); // value → label
    instances.set('superadmin', 'Super Admin');
    for (const e of history) {
      if (e.type === 'instance-admin' && e.instanceId && e.instanceLabel) {
        instances.set(e.instanceId, e.instanceLabel);
      }
    }
    return [...instances.entries()];
  });

  const filteredEmailHistory = createMemo(() => {
    let history = props.emailHistory ?? [];

    const from = dateFrom();
    const to = dateTo();
    const inst = instanceFilter();

    if (from) {
      const fromMs = new Date(from).getTime();
      history = history.filter(e => e.sentAt >= fromMs);
    }
    if (to) {
      // include the whole end day
      const toMs = new Date(to).getTime() + 86400000;
      history = history.filter(e => e.sentAt < toMs);
    }
    if (inst) {
      history = history.filter(e =>
        inst === 'superadmin' ? e.type === 'superadmin' : e.instanceId === inst
      );
    }

    return history;
  });

  const handleOpenEmail = async (entry: SentEmailSummary) => {
    setLoadingEmail(true);
    const key = entry.type === 'superadmin' ? 'superadmin' : (entry.instanceId ?? 'superadmin');
    const html = await props.onViewEmail(entry.id, key);
    setLoadingEmail(false);
    if (html) setViewingHtml(html);
  };

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div class="changelog-view-container">
      <div class="changelog-view-content">
        <Show when={props.loading || (filter() === 'emails' && props.emailHistoryLoading)}>
          <div class="changelog-view-loading">
            <div class="spinner"></div>
            <p>Loading</p>
          </div>
        </Show>
        <Show when={!props.loading && props.error && filter() !== 'emails'}>
          <div class="changelog-view-error">
            <p>Error loading changelog: {props.error?.message}</p>
          </div>
        </Show>
        <Show when={!props.loading && (!props.error || filter() === 'emails')}>
          <div class="changelog-filter-bar">
            <button
              type="button"
              class="changelog-filter-btn user"
              data-selected={filter() === 'user'}
              onClick={() => setFilter('user')}
            >
              User
            </button>
            <button
              type="button"
              class="changelog-filter-btn admin"
              data-selected={filter() === 'admin'}
              onClick={() => setFilter('admin')}
            >
              Admin
            </button>
            <button
              type="button"
              class="changelog-filter-btn emails"
              data-selected={filter() === 'emails'}
              onClick={() => setFilter('emails')}
            >
              Sent Emails
            </button>
          </div>

          <Show when={filter() === 'emails'}>
            <div class="email-history-filters">
              <input
                type="date"
                class="server-filter-input email-history-date-input"
                value={dateFrom()}
                onChange={(e) => setDateFrom(e.currentTarget.value)}
                title="From date"
              />
              <span class="email-history-filter-sep">to</span>
              <input
                type="date"
                class="server-filter-input email-history-date-input"
                value={dateTo()}
                onChange={(e) => setDateTo(e.currentTarget.value)}
                title="To date"
              />
              <select
                class="server-filter-select"
                value={instanceFilter()}
                onChange={(e) => setInstanceFilter(e.currentTarget.value)}
              >
                <option value="">All instances</option>
                <For each={instanceOptions()}>
                  {([value, label]) => <option value={value}>{label}</option>}
                </For>
              </select>
              <Show when={dateFrom() || dateTo() || instanceFilter()}>
                <button
                  type="button"
                  class="email-history-clear-btn"
                  onClick={() => { setDateFrom(''); setDateTo(''); setInstanceFilter(''); }}
                >
                  Clear
                </button>
              </Show>
            </div>
          </Show>

          <Show when={filter() !== 'emails'}>
            <Show
              when={filteredVersions().length > 0}
              fallback={<div class="changelog-view-empty"><p>No changelog entries found</p></div>}
            >
              <For each={filteredVersions()}>
                {(versionEntry) => (
                  <div class="changelog-version-block">
                    <h2 class="changelog-version-header">v{versionEntry.version}</h2>
                    <For each={versionEntry.types}>
                      {(typeGroup) => (
                        <div class="changelog-type-group">
                          <h3 class="changelog-type-header">
                            {typeGroup.type.charAt(0).toUpperCase() + typeGroup.type.slice(1)}
                          </h3>
                          <ul class="changelog-items">
                            <For each={typeGroup.items}>
                              {(item) => (
                                <li class="changelog-item">
                                  {item.desc}
                                </li>
                              )}
                            </For>
                          </ul>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </Show>

          <Show when={filter() === 'emails'}>
            <Show
              when={filteredEmailHistory().length > 0}
              fallback={<div class="changelog-view-empty"><p>No emails match the current filters</p></div>}
            >
              <div class="email-history-list">
                <For each={filteredEmailHistory()}>
                  {(entry) => (
                    <button
                      type="button"
                      class="email-history-row"
                      onClick={() => handleOpenEmail(entry)}
                      disabled={loadingEmail()}
                    >
                      <div class="email-history-row-left">
                        <span class={`email-history-badge ${entry.type}`}>
                          {entry.type === 'superadmin' ? 'Super Admin' : (entry.instanceLabel ?? 'Instance')}
                        </span>
                        <span class="email-history-subject">{entry.subject}</span>
                      </div>
                      <span class="email-history-date">{fmtDate(entry.sentAt)}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      <Show when={viewingHtml() !== null}>
        <SentEmailViewModal html={viewingHtml()!} onClose={() => setViewingHtml(null)} />
      </Show>
    </div>
  );
}
