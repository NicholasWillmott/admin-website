import { For, Show, createSignal } from 'solid-js';
import type { ChangelogVersion } from '../../types.ts';

type AudienceFilter = 'user' | 'admin';

interface ChangelogViewProps {
  changelog: { versions: ChangelogVersion[] } | undefined;
  loading: boolean;
  error: Error | undefined;
}

export function ChangelogView(props: ChangelogViewProps) {
  const [filter, setFilter] = createSignal<AudienceFilter>('admin');

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

  return (
    <div class="changelog-view-container">
      <div class="changelog-view-content">
        <Show when={props.loading}>
          <div class="changelog-view-loading">
            <div class="spinner"></div>
            <p>Loading Changelog</p>
          </div>
        </Show>
        <Show when={!props.loading && props.error}>
          <div class="changelog-view-error">
            <p>Error loading changelog: {props.error?.message}</p>
          </div>
        </Show>
        <Show when={!props.loading && !props.error}>
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
          </div>
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
      </div>
    </div>
  );
}
