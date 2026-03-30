import { createSignal, For } from 'solid-js';
import type { Server } from '../../types.ts';

interface MoveVolumeModalProps {
  server: Server;
  volumes: string[];
  inProgress: boolean;
  onClose: () => void;
  onConfirm: (serverId: string, newVolume: string) => Promise<void>;
}

export function MoveVolumeModal(props: MoveVolumeModalProps) {
  const availableVolumes = () => props.volumes.filter(v => v !== props.server.volume);
  const [selectedVolume, setSelectedVolume] = createSignal(availableVolumes()[0] ?? '');

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 420px">
        <div class="modal-header">
          <h2>Move to Volume — {props.server.label}</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <div class="config-rows">

            <div class="config-row">
              <span class="config-label">Current Volume</span>
              <span style="color: var(--text-muted, #888); font-size: 14px;">
                {props.server.volume ? `/mnt/${props.server.volume}` : 'default mount'}
              </span>
            </div>

            <div class="config-row">
              <span class="config-label">Move To</span>
              <select
                value={selectedVolume()}
                onChange={(e) => setSelectedVolume(e.currentTarget.value)}
                style="flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color, #ccc); background: var(--input-bg, #fff); color: #000; font-size: 14px;"
              >
                <For each={availableVolumes()}>
                  {(vol) => <option value={vol}>/mnt/{vol}</option>}
                </For>
              </select>
            </div>

          </div>

          <div style="margin-top: 16px; padding: 10px 12px; background: #7c2d1220; border: 1px solid #dc262640; border-radius: 6px; font-size: 13px; color: #dc2626;">
            The server will be <strong>stopped</strong>, its data copied to the new volume, then <strong>restarted</strong>. This may take several minutes depending on data size.
          </div>

          <button
            type="button"
            class="action-btn docker-pull"
            style="width: 100%; margin-top: 20px"
            disabled={!selectedVolume() || props.inProgress}
            onClick={() => props.onConfirm(props.server.id, selectedVolume())}
          >
            {props.inProgress ? (
              <>
                <span class="button-spinner"></span>
                Moving...
              </>
            ) : (
              `Move to /mnt/${selectedVolume()}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
