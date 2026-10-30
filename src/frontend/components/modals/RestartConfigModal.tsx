import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';

interface RestartConfigModalProps {
  serverLabel: string;
  onRestartNow: () => void;
  onClose: () => void;
}

export function RestartConfigModal(props: RestartConfigModalProps) {
  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 420px">
        <div class="modal-header">
          <h2>Restart Required</h2>
          <button class="modal-close" onClick={() => props.onClose()}><Icon name="x" /></button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom: 20px; padding: 10px 12px; background: rgba(245, 158, 11, 0.08); border-left: 4px solid rgba(245, 158, 11, 0.3); border-radius: 6px; font-size: 13px; color: #fbbf24;">
            Configuration for <strong>{props.serverLabel}</strong> has been saved, but the changes won't be enacted until the server is restarted. Do you want to restart now?
          </div>
          <div style="display: flex; gap: 8px">
            <Button
              type="button"
              block
              onClick={() => props.onClose()}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              icon="restart"
              block
              onClick={() => props.onRestartNow()}
            >
              Restart now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
