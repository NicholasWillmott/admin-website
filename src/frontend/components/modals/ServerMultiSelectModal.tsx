import { createSignal } from 'solid-js';
import { For, Show } from 'solid-js';

interface multiSelectProps {
  serverIds: string[];
  versions: string[];
  sshOperationInProgress: boolean;
  onUpdate: (serverIds: string[], version: string) => Promise<void>;
}

export function ServerMultiSelectModal(props: multiSelectProps) {
  const [selectedVersion, setSelectedVersion] = createSignal(props.versions[0] ?? '');
  const [confirming, setConfirming] = createSignal(false);

  return (
    <div class="multi-select-modal">
      <div class="multi-select-modal-content">
        <Show when={!confirming()} fallback={
          <>
            <h3>Confirm Bulk Update</h3>
            <p>Update <strong>{props.serverIds.length} servers</strong> to version <strong>{selectedVersion()}</strong>?</p>
            <p class="multi-select-server-list">{props.serverIds.join(', ')}</p>
            <div class="multi-select-confirm-actions">
              <button
                class="update-btn"
                onClick={() => props.onUpdate(props.serverIds, selectedVersion())}
                disabled={props.sshOperationInProgress}
              >
                {props.sshOperationInProgress ? 'Updating...' : 'Confirm Update'}
              </button>
              <button
                class="action-btn"
                onClick={() => setConfirming(false)}
                disabled={props.sshOperationInProgress}
              >
                Go Back
              </button>
            </div>
          </>
        }>
          <h3>Bulk Update ({props.serverIds.length} servers)</h3>
          <p>{props.serverIds.join(', ')}</p>
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
            onClick={() => setConfirming(true)}
            disabled={!selectedVersion() || props.sshOperationInProgress}
          >
            Update All
          </button>
        </Show>
      </div>
    </div>
  );
}
