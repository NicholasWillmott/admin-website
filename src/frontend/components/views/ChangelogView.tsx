import { For, Show } from 'solid-js';
import type { ChangelogVersion } from '../../types.ts';

interface ChangelogViewProps {
  changelog: { versions: ChangelogVersion[] } | undefined;
  loading: boolean;
  error: Error | undefined;
}

export function ChangelogView(props: ChangelogViewProps) {
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
        <Show when={!props.loading && !props.error && (props.changelog?.versions.length ?? 0) === 0}>
          <div class="changelog-view-empty">
            <p>No changelog entries found</p>
          </div>
        </Show>
        <Show when={!props.loading && !props.error && (props.changelog?.versions.length ?? 0) > 0}>
          <For each={props.changelog?.versions}>
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
                              <span class={`changelog-audience-badge ${item.audience}`}>{item.audience}</span>
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
      </div>
    </div>
  );
}
