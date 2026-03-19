import { createSignal } from 'solid-js';
import { addToast } from '../../stores/toastStore.ts';
import { createCategoryApi } from '../../services.ts';

interface CreateCategoryModalProps {
  onClose: () => void;
  onCreated: () => void;
  getToken: () => Promise<string | null>;
}

export function CreateCategoryModal(props: CreateCategoryModalProps) {
  const [name, setName] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  const handleCreate = async () => {
    const trimmed = name().trim();
    if (!trimmed) return;

    setLoading(true);
    const token = await props.getToken();
    const result = await createCategoryApi(trimmed, token);
    setLoading(false);

    if (result.success) {
      addToast(`Category "${trimmed}" created`, 'success');
      props.onCreated();
    } else {
      addToast(result.error || 'Failed to create category', 'error');
    }
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 400px">
        <div class="modal-header">
          <h2>Create Category</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <div class="docker-pull-form">
            <label for="cc-name">Category Name</label>
            <input
              id="cc-name"
              type="text"
              class="version-input"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name().trim()) handleCreate(); }}
              placeholder="e.g. North Africa"
              autofocus
            />
            <div style="display: flex; gap: 8px; margin-top: 16px">
              <button
                type="button"
                class="action-btn"
                style="flex: 1; background: #444; color: #fff"
                onClick={() => props.onClose()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="action-btn docker-pull"
                style="flex: 1"
                onClick={handleCreate}
                disabled={!name().trim() || loading()}
              >
                {loading() ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
