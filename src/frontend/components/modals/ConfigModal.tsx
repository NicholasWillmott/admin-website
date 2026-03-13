import type { Server } from '../../types.ts';

interface ConfigModalProps {
  server: Server;
  sshOperationInProgress: boolean;
  onClose: () => void;
  onUpdateLanguage: (serverId: string, french: boolean) => Promise<void>;
  onUpdateCalendar: (serverId: string, ethiopian: boolean) => Promise<void>;
  onUpdateOpenAccess: (serverId: string, openAccess: boolean) => Promise<void>;
}

export function ConfigModal(props: ConfigModalProps) {
  const disabled = () => props.sshOperationInProgress;

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
                  class={`config-toggle-btn ${!props.server.french ? 'active' : ''}`}
                  disabled={disabled() || !props.server.french}
                  onClick={() => props.onUpdateLanguage(props.server.id, false)}
                >
                  English
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${props.server.french ? 'active' : ''}`}
                  disabled={disabled() || !!props.server.french}
                  onClick={() => props.onUpdateLanguage(props.server.id, true)}
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
                  class={`config-toggle-btn ${!props.server.ethiopian ? 'active' : ''}`}
                  disabled={disabled() || !props.server.ethiopian}
                  onClick={() => props.onUpdateCalendar(props.server.id, false)}
                >
                  Gregorian
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${props.server.ethiopian ? 'active' : ''}`}
                  disabled={disabled() || !!props.server.ethiopian}
                  onClick={() => props.onUpdateCalendar(props.server.id, true)}
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
                  class={`config-toggle-btn ${!props.server.openAccess ? 'active' : ''}`}
                  disabled={disabled() || !props.server.openAccess}
                  onClick={() => props.onUpdateOpenAccess(props.server.id, false)}
                >
                  Off
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${props.server.openAccess ? 'active' : ''}`}
                  disabled={disabled() || !!props.server.openAccess}
                  onClick={() => props.onUpdateOpenAccess(props.server.id, true)}
                >
                  On
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
