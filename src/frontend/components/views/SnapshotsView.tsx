import { createSignal, For, Show, createEffect } from 'solid-js';
import { formatDate } from '../../utils.ts';

interface Snapshot {
  id: string;
  name: string;
  created_at: string;
  size_gigabytes: number;
}

interface SnapshotsViewProps {
  snapshots: Snapshot[] | undefined;
  volumes: string[];
  loading: boolean;
  error: Error | undefined;
  snappingVolume: boolean;
  onCreateSnapshot: (volume: string, name: string) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
}

export function SnapshotsView(props: SnapshotsViewProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [selectedVolume, setSelectedVolume] = createSignal('');
  const [snapshotName, setSnapshotName] = createSignal('');

  const defaultName = () => {
    const vol = selectedVolume();
    if (!vol) return '';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    return `${vol}-snapshot-${ts}`;
  };

  // Reserved by the cleanup-snapshots.sh rotation job — names containing these
  // substrings get matched by its retention policy and deleted within days.
  const reservedSubstring = () => {
    const name = snapshotName();
    for (const tag of ['-daily-', '-weekly-', '-monthly-']) {
      if (name.includes(tag)) return tag;
    }
    return null;
  };

  createEffect(() => {
    if (pickerOpen() && !selectedVolume() && props.volumes.length > 0) {
      setSelectedVolume(props.volumes[0]);
    }
  });

  // Reset the name to a fresh default each time the modal opens or the volume changes
  createEffect(() => {
    if (pickerOpen()) {
      selectedVolume();
      setSnapshotName(defaultName());
    }
  });

  // Close the modal once the snapshot operation finishes
  let wasSnapping = false;
  createEffect(() => {
    if (wasSnapping && !props.snappingVolume) setPickerOpen(false);
    wasSnapping = props.snappingVolume;
  });

  const sortedSnapshots = () => {
    const snapshots = props.snapshots;
    if (!snapshots) return [];
    return [...snapshots].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  };

  return (
    <div class="snapshots-container">
      <div class="snapshots-content">
        <div class="snapshots-header">
          <button
            class="system-btn snapshot"
            onClick={() => setPickerOpen(true)}
            disabled={props.snappingVolume || props.volumes.length === 0}
          >
            {props.snappingVolume ? (
              <>
                <span class="button-spinner"></span>
                Creating Volume Snapshot...
              </>
            ) : (
              'Create Volume Snapshot'
            )}
          </button>
        </div>

        {props.loading ? (
          <div class="snapshots-loading">
            <div class="spinner"></div>
            <p>Loading Snapshots</p>
          </div>
        ) : props.error ? (
          <div class="snapshots-error">
            <p>Error loading snapshots: {props.error.message}</p>
          </div>
        ) : props.snapshots && props.snapshots.length === 0 ? (
          <div class="no-snapshots">
            <p>No volume snapshots found</p>
          </div>
        ) : (
          <div class="snapshots-table-container">
            <table class="snapshots-table">
              <thead>
                <tr>
                  <th>Snapshot Name</th>
                  <th>Created</th>
                  <th>Size</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <For each={sortedSnapshots()}>
                  {(snapshot) => (
                    <tr>
                      <td class="snapshot-name">{snapshot.name}</td>
                      <td class="snapshot-date">{formatDate(snapshot.created_at)}</td>
                      <td class="snapshot-size">{snapshot.size_gigabytes} GB</td>
                      <td class="snapshot-actions">
                        <button
                          type="button"
                          class="delete-btn"
                          onClick={() => props.onDeleteSnapshot(snapshot.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Show when={pickerOpen()}>
        <div class="modal-overlay" onClick={() => !props.snappingVolume && setPickerOpen(false)}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 420px">
            <div class="modal-header">
              <h2>Create Volume Snapshot</h2>
              <button
                class="modal-close"
                onClick={() => setPickerOpen(false)}
                disabled={props.snappingVolume}
              >
                ✕
              </button>
            </div>
            <div class="modal-body">
              <div class="docker-pull-form">
                <label for="snapshot-volume">Volume</label>
                <select
                  id="snapshot-volume"
                  class="version-input"
                  value={selectedVolume()}
                  onChange={(e) => setSelectedVolume(e.currentTarget.value)}
                  disabled={props.snappingVolume}
                >
                  <For each={props.volumes}>
                    {(vol) => <option value={vol}>/mnt/{vol}</option>}
                  </For>
                </select>
                <label for="snapshot-name">Snapshot Name</label>
                <input
                  id="snapshot-name"
                  type="text"
                  class="version-input"
                  value={snapshotName()}
                  onInput={(e) => setSnapshotName(e.currentTarget.value)}
                  placeholder={defaultName()}
                  disabled={props.snappingVolume}
                />
                <Show when={reservedSubstring()}>
                  {(tag) => (
                    <div style="margin-top: -4px; padding: 8px 12px; background: rgba(239, 68, 68, 0.08); border-left: 4px solid rgba(239, 68, 68, 0.3); border-radius: 4px; font-size: 13px; color: #f87171;">
                      Name cannot contain <strong>{tag()}</strong> — that pattern is reserved for the automated rotation job and would cause this snapshot to be deleted.
                    </div>
                  )}
                </Show>
                <button
                  type="button"
                  class="action-btn docker-pull"
                  onClick={() => props.onCreateSnapshot(selectedVolume(), snapshotName().trim())}
                  disabled={!selectedVolume() || !snapshotName().trim() || !!reservedSubstring() || props.snappingVolume}
                >
                  {props.snappingVolume ? (
                    <>
                      <span class="button-spinner"></span>
                      Creating Snapshot...
                    </>
                  ) : (
                    'Create Snapshot'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
