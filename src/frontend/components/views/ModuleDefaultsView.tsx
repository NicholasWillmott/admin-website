import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { fetchModuleDefaults } from '../../services.ts';
import { buildSections, shortRef } from './moduleDefaultsMatrix.ts';
import { Button } from '../ui/Button.tsx';

interface ModuleDefaultsViewProps {
  getToken: () => Promise<string | null>;
}

// Fleet matrix of every country's module defaults (the platform's
// `run_generation_defaults` store) against each parameter's definition
// default. "Only differing countries" narrows the columns to countries with
// at least one differing parameter (unread countries are then listed above
// the table). Read-only: resets happen in each instance's own editor. Row model and
// comparison rule in moduleDefaultsMatrix.ts.

export function ModuleDefaultsView(props: ModuleDefaultsViewProps) {
  const [onlyDiffering, setOnlyDiffering] = createSignal(false);
  const [onlyDifferingCountries, setOnlyDifferingCountries] = createSignal(false);
  const [search, setSearch] = createSignal('');

  const [data, { refetch }] = createResource(async () => {
    const token = await props.getToken();
    return fetchModuleDefaults(token);
  });

  const countries = () => data()?.countries ?? [];
  const sections = createMemo(() => buildSections(countries()));

  const differingByCountry = createMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sections()) {
      for (const r of s.rows) {
        for (const [id, cell] of Object.entries(r.cells)) {
          if (cell?.differsFromDefault) counts[id] = (counts[id] ?? 0) + 1;
        }
      }
    }
    return counts;
  });

  const differingCountries = createMemo(() =>
    countries().filter((c) => (differingByCountry()[c.id] ?? 0) > 0)
  );

  const shownCountries = () => (onlyDifferingCountries() ? differingCountries() : countries());

  const unread = () =>
    countries()
      .filter((c) => c.state !== 'ok')
      .map((c) => (c.state === 'not_v2' ? `${c.label} (v${c.serverVersion})` : `${c.label} (unreachable)`));

  const visibleSections = createMemo(() => {
    const q = search().toLowerCase();
    return sections()
      .map((s) => ({
        ...s,
        rows: s.rows.filter((r) =>
          (!onlyDiffering() || Object.values(r.cells).some((cell) => cell?.differsFromDefault)) &&
          (!q ||
            r.label.toLowerCase().includes(q) ||
            (r.sublabel ?? '').toLowerCase().includes(q) ||
            s.label.toLowerCase().includes(q))
        ),
      }))
      .filter((s) => s.rows.length > 0);
  });

  const summary = () => {
    const all = countries();
    const live = all.filter((c) => c.state === 'ok');
    return { all: all.length, live: live.length, differing: differingCountries().length };
  };

  return (
    <div class="mdd-container">
      <div class="mdd-content">
        <div class="mdd-header">
          <h2 class="mdd-title">Module Defaults</h2>
          <div class="mdd-filters">
            <input
              class="mdd-search"
              type="text"
              placeholder="Filter parameters…"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
            <label class="mdd-toggle">
              <input type="checkbox" checked={onlyDiffering()} onChange={(e) => setOnlyDiffering(e.currentTarget.checked)} />
              Only differing from default
            </label>
            <label class="mdd-toggle">
              <input
                type="checkbox"
                checked={onlyDifferingCountries()}
                onChange={(e) => setOnlyDifferingCountries(e.currentTarget.checked)}
              />
              Only differing countries
            </label>
            <Button icon="refresh" onClick={() => refetch()} disabled={data.loading}>
              Refresh
            </Button>
          </div>
        </div>

        <Show when={data.loading}>
          <div class="mdd-loading">
            <div class="mdd-spinner" />
            Reading every country's module defaults…
          </div>
        </Show>

        <Show when={data.error}>
          <div class="mdd-alert mdd-alert-error">{String(data.error)}</div>
        </Show>

        <Show when={!data.loading && data()}>
          <div class="mdd-meta">
            <span><strong>{summary().live}</strong> of {summary().all} countries read</span>
            <span class={summary().differing > 0 ? 'mdd-meta-warn' : ''}>
              <strong>{summary().differing}</strong> countries differ from a definition default
            </span>
            <Show when={onlyDifferingCountries() && unread().length > 0}>
              <span>Not read: {unread().join(', ')}</span>
            </Show>
          </div>

          <div class="mdd-legend">
            <span><span class="mdd-swatch mdd-swatch-drift" /> Differs from the module's definition default (its defaultValue in definition.json)</span>
          </div>

          <Show
            when={sections().length > 0}
            fallback={<div class="mdd-empty">No v2 country answered.</div>}
          >
            <Show
              when={shownCountries().length > 0}
              fallback={<div class="mdd-empty">Every country matches the definition defaults.</div>}
            >
              <div class="mdd-scroll">
                <table class="mdd-table">
                  <thead>
                    <tr>
                      <th class="mdd-sticky mdd-col-label">Setting</th>
                      <th class="mdd-sticky mdd-col-def">Definition default</th>
                      <For each={shownCountries()}>
                        {(c) => (
                          <th class="mdd-col-country" title={c.error ?? ''}>
                            <div class="mdd-country-name">{c.label}</div>
                            <div class="mdd-country-meta">
                              {c.state === 'not_v2'
                                ? `v${c.serverVersion}, not on v2`
                                : c.state === 'unreachable'
                                ? 'unreachable'
                                : `${differingByCountry()[c.id] ?? 0} differ`}
                            </div>
                            <Show when={c.snapshot}>
                              {(s) => <div class="mdd-country-ref">modules {shortRef(s().modulesGitRef)}</div>}
                            </Show>
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={visibleSections()}>
                      {(section) => (
                        <>
                          <tr class="mdd-section-row">
                            <td class="mdd-sticky mdd-col-label mdd-section-label">{section.label}</td>
                            <td class="mdd-sticky mdd-col-def" />
                            <td colSpan={shownCountries().length} />
                          </tr>
                          <For each={section.rows}>
                            {(row) => (
                              <tr class="mdd-row">
                                <td class="mdd-sticky mdd-col-label">
                                  <div class="mdd-row-label">{row.label}</div>
                                  <Show when={row.sublabel}>
                                    <div class="mdd-row-sublabel">{row.sublabel}</div>
                                  </Show>
                                </td>
                                <td class="mdd-sticky mdd-col-def">
                                  <div class="mdd-mono">{row.defaultText}</div>
                                  <Show when={row.defaultNote}>
                                    <div class="mdd-row-sublabel">{row.defaultNote}</div>
                                  </Show>
                                </td>
                                <For each={shownCountries()}>
                                  {(c) => {
                                    const cell = () => row.cells[c.id];
                                    return (
                                      <td
                                        class={`mdd-cell ${cell()?.differsFromDefault ? 'mdd-cell-drift' : ''}`}
                                        title={cell()?.differsFromDefault ? `Definition default: ${row.defaultText}` : cell()?.text ?? ''}
                                      >
                                        {cell()?.text ?? '—'}
                                      </td>
                                    );
                                  }}
                                </For>
                              </tr>
                            )}
                          </For>
                        </>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
