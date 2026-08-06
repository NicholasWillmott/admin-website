import { createSignal } from 'solid-js';
import { For, Show } from 'solid-js';
import { filterAdhocVersions, parseVersion } from '../../utils.ts';

type ConfirmAction = 'update' | 'restart' | 'stop' | null;

interface multiSelectProps {
  serverIds: string[];
  versions: string[];
  centralVersions: string[];
  isCentral: boolean;
  sshOperationInProgress: boolean;
  onUpdate: (serverIds: string[], version: string) => Promise<void>;
  onRestart: (serverIds: string[]) => Promise<void>;
  onStop: (serverIds: string[]) => Promise<void>;
}

const DISPLAY_LIMIT = 5;

function ServerListLabel(props: { ids: string[] }) {
  const extra = () => Math.max(0, props.ids.length - DISPLAY_LIMIT);
  const displayed = () => props.ids.slice(0, DISPLAY_LIMIT).join(', ');
  const fullList = () => props.ids.join('\n');

  return (
    <div class="server-list-wrapper">
      <span class="server-list-text">
        {displayed()}
        <Show when={extra() > 0}>
          <span class="server-list-overflow"> +{extra()} more</span>
        </Show>
      </span>
      <Show when={extra() > 0}>
        <div class="server-list-tooltip">{fullList()}</div>
      </Show>
    </div>
  );
}

export function ServerMultiSelectModal(props: multiSelectProps) {
  // Semver by default — ad-hoc deploys are opt-in via the Ad-hoc toggle
  const semverVersions = () =>
    (props.isCentral ? props.centralVersions : props.versions).filter((v) => parseVersion(v) !== null);
  const adhocVersions = () => filterAdhocVersions(props.isCentral ? props.centralVersions : props.versions);
  const [selectedVersion, setSelectedVersion] = createSignal(semverVersions()[0] ?? '');
  const [showAdhoc, setShowAdhoc] = createSignal(false);
  const [confirmAction, setConfirmAction] = createSignal<ConfirmAction>(null);

  const toggleAdhoc = () => {
    const next = !showAdhoc();
    setShowAdhoc(next);
    if (!next && parseVersion(selectedVersion()) === null) {
      setSelectedVersion(semverVersions()[0] ?? '');
    }
  };

  const count = () => props.serverIds.length;

  return (
    <div class="multi-select-modal">
      <div class="multi-select-modal-content">
        <Show when={confirmAction() !== null} fallback={
          <>
            <h3>Bulk Actions ({count()} servers)</h3>
            <ServerListLabel ids={props.serverIds} />
            <label>
              <strong>Version:</strong>
              <select
                class="version-select"
                value={selectedVersion()}
                onChange={(e) => setSelectedVersion(e.currentTarget.value)}
              >
                <For each={semverVersions()}>
                  {(version) => <option value={version}>{version}</option>}
                </For>
                <Show when={showAdhoc()}>
                  <optgroup label="Ad-hoc deploys">
                    <Show when={adhocVersions().length > 0} fallback={<option disabled>No ad-hoc deploys found</option>}>
                      <For each={adhocVersions()}>
                        {(version) => <option value={version}>{version}</option>}
                      </For>
                    </Show>
                  </optgroup>
                </Show>
              </select>
            </label>
            <button
              type="button"
              class={`adhoc-toggle-btn ${showAdhoc() ? 'active' : ''}`}
              title={showAdhoc() ? 'Hide ad-hoc deploys from the version list' : 'Show ad-hoc deploys in the version list'}
              onClick={toggleAdhoc}
            >
              Ad-hoc
            </button>
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
            <ServerListLabel ids={props.serverIds} />
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
            <ServerListLabel ids={props.serverIds} />
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
            <ServerListLabel ids={props.serverIds} />
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
