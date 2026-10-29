import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { fetchModuleDefaults } from '../../services.ts';
import { buildSections, shortRef } from './moduleDefaultsMatrix.ts';

interface ModuleDefaultsViewProps {
  getToken: () => Promise<string | null>;
}

// Fleet matrix of every country's module defaults (the platform's
// `run_generation_defaults` store) against its frozen baseline in the
// resource hub. Read-only: resets happen in each instance's own editor.
// Row model and drift rule in moduleDefaultsMatrix.ts.

export function ModuleDefaultsView(props: ModuleDefaultsViewProps) {
  const [onlyDrift, setOnlyDrift] = createSignal(false);
  const [search, setSearch] = createSignal('');

  const [data, { refetch }] = createResource(async () => {
    const token = await props.getToken();
    return fetchModuleDefaults(token);
  });

  const countries = () => data()?.countries ?? [];
  const sections = createMemo(() => buildSections(countries()));

  const driftCountByCountry = createMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sections()) {
      for (const r of s.rows) {
        for (const [id, cell] of Object.entries(r.cells)) {
          if (cell?.drift) counts[id] = (counts[id] ?? 0) + 1;
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
          (!onlyDrift() || Object.values(r.cells).some((cell) => cell?.drift)) &&
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
    const withBaseline = live.filter((c) => c.baseline);
    const drifted = withBaseline.filter((c) => (driftCountByCountry()[c.id] ?? 0) > 0);
    return { all: all.length, live: live.length, withBaseline: withBaseline.length, drifted: drifted.length };
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
              <input type="checkbox" checked={onlyDrift()} onChange={(e) => setOnlyDrift(e.currentTarget.checked)} />
              Only changed from baseline
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
          <Show when={data()?.baselineError}>
            <div class="mdd-alert mdd-alert-error">
              Could not read the baseline file: {data()?.baselineError}
            </div>
          </Show>

          <div class="mdd-meta">
            <span><strong>{summary().live}</strong> of {summary().all} countries read</span>
            <span><strong>{summary().withBaseline}</strong> with a baseline</span>
            <span class={summary().drifted > 0 ? 'mdd-meta-warn' : ''}>
              <strong>{summary().drifted}</strong> changed from baseline
            </span>
          </div>

          <div class="mdd-legend">
            <span><span class="mdd-swatch mdd-swatch-drift" /> Changed from the country's baseline (hover for the baseline value)</span>
            <span><span class="mdd-swatch mdd-swatch-custom" /> Differs from the module definition default</span>
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
                    <th class="mdd-sticky mdd-col-def">Definition default</th>
                    <For each={countries()}>
                      {(c) => (
                        <th class="mdd-col-country" title={c.error ?? ''}>
                          <div class="mdd-country-name">{c.label}</div>
                          <div class="mdd-country-meta">
                            {c.state === 'not_v2'
                              ? `v${c.serverVersion}, not on v2`
                              : c.state === 'unreachable'
                              ? 'unreachable'
                              : c.baseline
                              ? `${driftCountByCountry()[c.id] ?? 0} changed · baseline ${c.baseline.snapshotAt.slice(0, 10)}`
                              : 'no baseline'}
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
                              <td class="mdd-sticky mdd-col-def mdd-mono">{row.definitionText}</td>
                              <For each={countries()}>
                                {(c) => {
                                  const cell = () => row.cells[c.id];
                                  return (
                                    <td
                                      class={`mdd-cell ${cell()?.drift ? 'mdd-cell-drift' : ''} ${
                                        cell()?.differsFromDefinition ? 'mdd-cell-custom' : ''
                                      }`}
                                      title={cell()?.drift ? `Baseline: ${cell()?.baselineText}` : cell()?.text ?? ''}
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
