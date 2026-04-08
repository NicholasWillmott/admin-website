import { createSignal } from 'solid-js';
import { For, Show } from 'solid-js';

type ConfirmAction = 'update' | 'restart' | 'stop' | null;

interface multiSelectProps {
  serverIds: string[];
  versions: string[];
  sshOperationInProgress: boolean;
  onUpdate: (serverIds: string[], version: string) => Promise<void>;
  onRestart: (serverIds: string[]) => Promise<void>;
  onStop: (serverIds: string[]) => Promise<void>;
}

export function ServerMultiSelectModal(props: multiSelectProps) {
  const [selectedVersion, setSelectedVersion] = createSignal(props.versions[0] ?? '');
  const [confirmAction, setConfirmAction] = createSignal<ConfirmAction>(null);

  const serverList = () => props.serverIds.join(', ');
  const count = () => props.serverIds.length;

  return (
    <div class="multi-select-modal">
      <div class="multi-select-modal-content">
        <Show when={confirmAction() !== null} fallback={
          <>
            <h3>Bulk Actions ({count()} servers)</h3>
            <p>{serverList()}</p>
            <label>
              <strong>Version:</strong>
              <select
                class="version-select"
                value={selectedVersion()}
                onChange={(e) => setSelectedVersion(e.currentTarget.value)}
              >
                <For each={props.versions}>
                  {(version) => <option value={version}>{version}</option>}
                </For>
              </select>
            </label>
            <button
              class="update-btn"
              onClick={() => setConfirmAction('update')}
              disabled={!selectedVersion() || props.sshOperationInProgress}
            >
              Update All
            </button>
            <button
              class="action-btn restart"
              onClick={() => setConfirmAction('restart')}
              disabled={props.sshOperationInProgress}
            >
              Restart All
            </button>
            <button
              class="action-btn stop"
              onClick={() => setConfirmAction('stop')}
              disabled={props.sshOperationInProgress}
            >
              Stop All
            </button>
          </>
        }>
          <Show when={confirmAction() === 'update'}>
            <h3>Confirm Bulk Update</h3>
            <p>Update <strong>{count()} servers</strong> to version <strong>{selectedVersion()}</strong>?</p>
            <p class="multi-select-server-list">{serverList()}</p>
            <div class="multi-select-confirm-actions">
              <button
                class="update-btn"
                onClick={() => props.onUpdate(props.serverIds, selectedVersion())}
                disabled={props.sshOperationInProgress}
              >
                {props.sshOperationInProgress ? 'Updating...' : 'Confirm Update'}
              </button>
              <button class="action-btn" onClick={() => setConfirmAction(null)} disabled={props.sshOperationInProgress}>
                Go Back
              </button>
            </div>
          </Show>
          <Show when={confirmAction() === 'restart'}>
            <h3>Confirm Bulk Restart</h3>
            <p>Restart <strong>{count()} servers</strong>?</p>
            <p class="multi-select-server-list">{serverList()}</p>
            <div class="multi-select-confirm-actions">
              <button
                class="action-btn restart"
                onClick={() => props.onRestart(props.serverIds)}
                disabled={props.sshOperationInProgress}
              >
                {props.sshOperationInProgress ? 'Restarting...' : 'Confirm Restart'}
              </button>
              <button class="action-btn" onClick={() => setConfirmAction(null)} disabled={props.sshOperationInProgress}>
                Go Back
              </button>
            </div>
          </Show>
          <Show when={confirmAction() === 'stop'}>
            <h3>Confirm Bulk Stop</h3>
            <p>Stop <strong>{count()} servers</strong>?</p>
            <p class="multi-select-server-list">{serverList()}</p>
            <div class="multi-select-confirm-actions">
              <button
                class="action-btn stop"
                onClick={() => props.onStop(props.serverIds)}
                disabled={props.sshOperationInProgress}
              >
                {props.sshOperationInProgress ? 'Stopping...' : 'Confirm Stop'}
              </button>
              <button class="action-btn" onClick={() => setConfirmAction(null)} disabled={props.sshOperationInProgress}>
                Go Back
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
