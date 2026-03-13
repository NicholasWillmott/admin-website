import { createSignal } from 'solid-js';
import type { Server } from '../../types.ts';

type ConfigChanges = { french?: boolean; ethiopian?: boolean; openAccess?: boolean };

interface ConfigModalProps {
  server: Server;
  sshOperationInProgress: boolean;
  onClose: () => void;
  onSave: (serverId: string, changes: ConfigChanges) => Promise<void>;
}

export function ConfigModal(props: ConfigModalProps) {
  const [french, setFrench] = createSignal(props.server.french ?? false);
  const [ethiopian, setEthiopian] = createSignal(props.server.ethiopian ?? false);
  const [openAccess, setOpenAccess] = createSignal(props.server.openAccess ?? false);

  const hasChanges = () =>
    french() !== (props.server.french ?? false) ||
    ethiopian() !== (props.server.ethiopian ?? false) ||
    openAccess() !== (props.server.openAccess ?? false);

  const handleSave = () => {
    const changes: ConfigChanges = {};
    if (french() !== (props.server.french ?? false)) changes.french = french();
    if (ethiopian() !== (props.server.ethiopian ?? false)) changes.ethiopian = ethiopian();
    if (openAccess() !== (props.server.openAccess ?? false)) changes.openAccess = openAccess();
    props.onSave(props.server.id, changes);
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 420px">
        <div class="modal-header">
          <h2>Configuration — {props.server.label}</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <div class="config-rows">

            <div class="config-row">
              <span class="config-label">Language</span>
              <div class="config-toggle-group">
                <button
                  type="button"
                  class={`config-toggle-btn ${!french() ? 'active' : ''}`}
                  onClick={() => setFrench(false)}
                >
                  English
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${french() ? 'active' : ''}`}
                  onClick={() => setFrench(true)}
                >
                  French
                </button>
              </div>
            </div>

            <div class="config-row">
              <span class="config-label">Calendar</span>
              <div class="config-toggle-group">
                <button
                  type="button"
                  class={`config-toggle-btn ${!ethiopian() ? 'active' : ''}`}
                  onClick={() => setEthiopian(false)}
                >
                  Gregorian
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${ethiopian() ? 'active' : ''}`}
                  onClick={() => setEthiopian(true)}
                >
                  Ethiopian
                </button>
              </div>
            </div>

            <div class="config-row">
              <span class="config-label">Open Access</span>
              <div class="config-toggle-group">
                <button
                  type="button"
                  class={`config-toggle-btn ${!openAccess() ? 'active' : ''}`}
                  onClick={() => setOpenAccess(false)}
                >
                  Off
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${openAccess() ? 'active' : ''}`}
                  onClick={() => setOpenAccess(true)}
                >
                  On
                </button>
              </div>
            </div>

          </div>

          <button
            type="button"
            class="action-btn docker-pull"
            style="width: 100%; margin-top: 20px"
            disabled={!hasChanges() || props.sshOperationInProgress}
            onClick={handleSave}
          >
            {props.sshOperationInProgress ? 'SSH Operation in Progress...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
