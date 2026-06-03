import { createSignal, For, Show } from 'solid-js';

const HISTORY_KEY = 'docker-pull-history';
const MAX_HISTORY = 5;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveToHistory(version: string, current: string[]): string[] {
  const deduped = [version, ...current.filter((v) => v !== version)].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(deduped));
  return deduped;
}

interface DockerPullModalProps {
  sshOperationInProgress: boolean;
  onClose: () => void;
  onPull: (version: string, type: 'server' | 'central') => Promise<void>;
}

export function DockerPullModal(props: DockerPullModalProps) {
  const [version, setVersion] = createSignal('');
  const [history, setHistory] = createSignal<string[]>(loadHistory());
  const [serverType, setServerType] = createSignal<'server' | 'central'>('server');

  function handlePull() {
    const v = version().trim();
    if (!v) return;
    setHistory(saveToHistory(v, history()));
    props.onPull(v, serverType());
  }

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class={`modal-content ${serverType() === 'central' ? 'central-mode' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Docker Pull</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <div class="docker-pull-form">
            <div class={`docker-pull-type-toggle ${serverType() === 'central' ? 'central-active' : ''}`}>
              <button
                type="button"
                class={`toggle-btn ${serverType() === 'server' ? 'active' : ''}`}
                onClick={() => setServerType('server')}
              >
                Server
              </button>
              <button
                type="button"
                class={`toggle-btn ${serverType() === 'central' ? 'active' : ''}`}
                onClick={() => setServerType('central')}
              >
                Central
              </button>
            </div>
            <label for="docker-version">Docker Version</label>
            <input
              id="docker-version"
              type="text"
              class="version-input"
              value={version()}
              onInput={(e) => setVersion(e.currentTarget.value)}
              placeholder="Enter version (e.g., 1.0.0)"
              autofocus
            />
            <Show when={history().length > 0}>
              <div class="docker-pull-history">
                <span class="docker-pull-history-label">Recent</span>
                <div class="docker-pull-history-chips">
                  <For each={history()}>
                    {(v) => (
                      <button
                        type="button"
                        class="docker-pull-history-chip"
                        onClick={() => setVersion(v)}
                      >
                        {v}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <button
              type="button"
              class="action-btn docker-pull"
              onClick={handlePull}
              disabled={!version().trim() || props.sshOperationInProgress}
            >
              Pull Docker Image
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
