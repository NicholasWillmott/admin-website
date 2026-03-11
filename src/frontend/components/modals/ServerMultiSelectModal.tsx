import { createSignal } from 'solid-js';
import { For } from 'solid-js';

interface multiSelectProps {
  serverIds: string[];
  versions: string[];
  sshOperationInProgress: boolean;
  onUpdate: (serverIds: string[], version: string) => Promise<void>;
}

export function ServerMultiSelectModal(props: multiSelectProps) {
  const [selectedVersion, setSelectedVersion] = createSignal(props.versions[0] ?? '');

  return (
    <div class="multi-select-modal">
      <div class="multi-select-modal-content">
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
          onClick={() => props.onUpdate(props.serverIds, selectedVersion())}
          disabled={!selectedVersion() || props.sshOperationInProgress}
        >
          {props.sshOperationInProgress ? 'Updating...' : 'Update All'}
        </button>
      </div>
    </div>
  );
}
