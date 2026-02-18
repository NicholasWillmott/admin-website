interface LogsModalProps {
  serverId: string;
  logs: string;
  loading: boolean;
  onClose: () => void;
}

export function LogsModal(props: LogsModalProps) {
  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Server Logs: {props.serverId}</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          {props.loading ? (
            <div class="logs-loading">
              <div class="spinner"></div>
              <p>Loading logs...</p>
            </div>
          ) : (
            <pre class="logs-display">{props.logs}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
