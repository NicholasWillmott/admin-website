import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { fetchModuleDefaults } from '../../services.ts';
import { buildSections, shortRef } from './moduleDefaultsMatrix.ts';

interface ModuleDefaultsViewProps {
  getToken: () => Promise<string | null>;
}

// Fleet matrix of every country's module defaults (the platform's
// `run_generation_defaults` store) against the fleet's global parameter
// defaults in the resource hub. Read-only: resets happen in each instance's
// own editor. Row model and comparison rule in moduleDefaultsMatrix.ts.

export function ModuleDefaultsView(props: ModuleDefaultsViewProps) {
  const [onlyDiffering, setOnlyDiffering] = createSignal(false);
  const [search, setSearch] = createSignal('');

  const [data, { refetch }] = createResource(async () => {
    const token = await props.getToken();
    return fetchModuleDefaults(token);
  });

  const countries = () => data()?.countries ?? [];
  const sections = createMemo(() => buildSections(countries(), data()?.global ?? null));

  const differingByCountry = createMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sections()) {
      for (const r of s.rows) {
        for (const [id, cell] of Object.entries(r.cells)) {
          if (cell?.differsFromGlobal) counts[id] = (counts[id] ?? 0) + 1;
        }
      }
    }
    return counts;
  });

  const visibleSections = createMemo(() => {
    const q = search().toLowerCase();
    return sections()
      .map((s) => ({
        ...s,
        rows: s.rows.filter((r) =>
          (!onlyDiffering() || Object.values(r.cells).some((cell) => cell?.differsFromGlobal)) &&
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
    const differing = live.filter((c) => (differingByCountry()[c.id] ?? 0) > 0);
    return { all: all.length, live: live.length, differing: differing.length };
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
              Only differing from global
            </label>
            <button class="mdd-button" onClick={() => refetch()} disabled={data.loading}>
              Refresh
            </button>
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
          <Show when={data()?.globalError}>
            <div class="mdd-alert mdd-alert-error">
              Could not read the global defaults file: {data()?.globalError}
            </div>
          </Show>
          <Show when={!data()?.global && !data()?.globalError}>
            <div class="mdd-alert mdd-alert-warning">
              Global defaults are not published yet. Run ./compute_module_defaults_global and commit
              module_defaults_global.json to fastr-resource-hub.
            </div>
          </Show>

          <div class="mdd-meta">
            <span><strong>{summary().live}</strong> of {summary().all} countries read</span>
            <Show when={data()?.global}>
              {(g) => <span>Global defaults computed <strong>{g().computedAt.slice(0, 10)}</strong> from {g().countries.length} countries</span>}
            </Show>
            <span class={summary().differing > 0 ? 'mdd-meta-warn' : ''}>
              <strong>{summary().differing}</strong> countries differ from a global default
            </span>
          </div>

          <div class="mdd-legend">
            <span><span class="mdd-swatch mdd-swatch-drift" /> Differs from the global default (the value most countries had when it was computed)</span>
          </div>

          <Show
            when={sections().length > 0}
            fallback={<div class="mdd-empty">No v2 country answered.</div>}
          >
            <div class="mdd-scroll">
              <table class="mdd-table">
                <thead>
                  <tr>
                    <th class="mdd-sticky mdd-col-label">Setting</th>
                    <th class="mdd-sticky mdd-col-def">Global default</th>
                    <For each={countries()}>
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
                          <td colSpan={countries().length} />
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
                                <div class="mdd-mono">{row.globalText}</div>
                                <Show when={row.globalNote}>
                                  <div class="mdd-row-sublabel">{row.globalNote}</div>
                                </Show>
                              </td>
                              <For each={countries()}>
                                {(c) => {
                                  const cell = () => row.cells[c.id];
                                  return (
                                    <td
                                      class={`mdd-cell ${cell()?.differsFromGlobal ? 'mdd-cell-drift' : ''}`}
                                      title={cell()?.differsFromGlobal ? `Global default: ${row.globalText}` : cell()?.text ?? ''}
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
      </div>
    </div>
  );
}
