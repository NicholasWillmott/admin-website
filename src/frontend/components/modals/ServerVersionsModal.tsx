import { For } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { Server } from '../../types.ts';

interface ServerVersionsModalProps {
  servers: Accessor<Server[] | undefined>;
  onClose: () => void;
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function ServerVersionsModal(props: ServerVersionsModalProps) {
  const sortedServers = () =>
    [...(props.servers() || [])].sort((a, b) =>
      compareVersionsDesc(a.serverVersion, b.serverVersion)
    );

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content server-versions-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Server Versions</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <div class="server-versions-grid">
            <For each={sortedServers()}>
              {(server) => (
                <div class="server-version-row">
                  <span class="server-version-label">{server.label || server.id}</span>
                  <span class="server-version-badge">{server.serverVersion}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
