import { Show, createSignal } from 'solid-js';

interface DeleteWhatsNewPostModalProps {
  postTitle: string;
  version: string;
  published: boolean;
  mediaCount: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteWhatsNewPostModal(props: DeleteWhatsNewPostModalProps) {
  const [deleting, setDeleting] = createSignal(false);

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await props.onConfirm();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div class="modal-overlay" onClick={() => { if (!deleting()) props.onClose(); }}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 460px">
        <div class="modal-header">
          <h2>Are you sure?</h2>
          <Show when={!deleting()}>
            <button class="modal-close" onClick={() => props.onClose()}>✕</button>
          </Show>
        </div>
        <div class="modal-body">
          <div class="docker-pull-form">
            <p style="color: #cbd5e1; margin-bottom: 12px">
              Delete <strong style="color: #e2e8f0">{props.postTitle || 'this post'}</strong>{' '}
              <span class="whats-new-version">v{props.version}</span>?
            </p>
            <p style="color: #f87171; margin-bottom: 16px">
              This is permanent and cannot be undone.
              <Show when={props.mediaCount > 0}>
                {' '}Its {props.mediaCount} uploaded {props.mediaCount === 1 ? 'file' : 'files'} will
                also be deleted, unless another post uses them.
              </Show>
            </p>
            <Show when={props.published}>
              <p style="color: #fbbf24; margin-bottom: 16px">
                This post is published — it will stop appearing on platform sites.
              </p>
            </Show>
            <div style="display: flex; gap: 8px; margin-top: 8px">
              <button
                type="button"
                class="action-btn"
                style="flex: 1"
                disabled={deleting()}
                onClick={() => props.onClose()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="action-btn danger"
                style="flex: 1"
                disabled={deleting()}
                onClick={handleConfirm}
              >
                {deleting() ? 'Deleting…' : 'Yes, delete post'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
