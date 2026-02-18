import { createSignal } from 'solid-js';

interface DockerPullModalProps {
  sshOperationInProgress: boolean;
  onClose: () => void;
  onPull: (version: string) => Promise<void>;
}

export function DockerPullModal(props: DockerPullModalProps) {
  const [version, setVersion] = createSignal('');

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Docker Pull</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <div class="docker-pull-form">
            <label for="docker-version">Docker Version</label>
            <input
              id="docker-version"
              type="text"
              class="version-input"
              value={version()}
              onInput={(e) => setVersion(e.currentTarget.value)}
              placeholder="Enter version (e.g., 1.0.0)"
              autofocus
            />
            <button
              type="button"
              class="action-btn docker-pull"
              onClick={() => props.onPull(version())}
              disabled={!version().trim() || props.sshOperationInProgress}
            >
              Pull Docker Image
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
