import { For } from 'solid-js';
import { formatDate } from '../../utils.ts';

interface Snapshot {
  id: string;
  name: string;
  created_at: string;
  size_gigabytes: number;
}

interface SnapshotsViewProps {
  snapshots: Snapshot[] | undefined;
  loading: boolean;
  error: Error | undefined;
  snappingVolume: boolean;
  onCreateSnapshot: () => void;
  onDeleteSnapshot: (snapshotId: string) => void;
}

export function SnapshotsView(props: SnapshotsViewProps) {
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
          <button class="system-btn snapshot" onClick={() => props.onCreateSnapshot()} disabled={props.snappingVolume}>
            {props.snappingVolume ? (
              <>
                <span class="button-spinner"></span>
                Creating Volume Snapshot...
              </>
            ): (
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
    </div>
  );
}
