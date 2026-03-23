import { createSignal, For, Show } from 'solid-js';
import { addToast } from '../../stores/toastStore.ts';
import { createCategoryApi, renameCategoryApi, deleteCategoryApi } from '../../services.ts';
import type { ServerCategory } from '../../services.ts';

interface ConfigureCategoriesModalProps {
  onClose: () => void;
  onUpdated: () => void;
  getToken: () => Promise<string | null>;
  categories: ServerCategory[];
}

export function ConfigureCategoriesModal(props: ConfigureCategoriesModalProps) {
  const [tab, setTab] = createSignal<'create' | 'edit'>('create');

  // Create tab state
  const [name, setName] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  // Edit tab state
  const [editingName, setEditingName] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal('');
  const [savingName, setSavingName] = createSignal<string | null>(null);
  const [deletingName, setDeletingName] = createSignal<string | null>(null);

  const handleCreate = async () => {
    const trimmed = name().trim();
    if (!trimmed) return;
    setCreating(true);
    const token = await props.getToken();
    const result = await createCategoryApi(trimmed, token);
    setCreating(false);
    if (result.success) {
      addToast(`Category "${trimmed}" created`, 'success');
      setName('');
      props.onUpdated();
    } else {
      addToast(result.error || 'Failed to create category', 'error');
    }
  };

  const handleRename = async (oldName: string) => {
    const newName = editValue().trim();
    if (!newName || newName === oldName) { setEditingName(null); return; }
    setSavingName(oldName);
    const token = await props.getToken();
    const result = await renameCategoryApi(oldName, newName, token);
    setSavingName(null);
    if (result.success) {
      addToast(`Category renamed to "${newName}"`, 'success');
      setEditingName(null);
      props.onUpdated();
    } else {
      addToast(result.error || 'Failed to rename category', 'error');
    }
  };

  const handleDelete = async (catName: string) => {
    if (!confirm(`Delete category "${catName}"? Its servers will become uncategorized.`)) return;
    setDeletingName(catName);
    const token = await props.getToken();
    const result = await deleteCategoryApi(catName, token);
    setDeletingName(null);
    if (result.success) {
      addToast(`Category "${catName}" deleted`, 'success');
      props.onUpdated();
    } else {
      addToast(result.error || 'Failed to delete category', 'error');
    }
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 450px">
        <div class="modal-header">
          <h2>Configure Categories</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div style="display: flex; border-bottom: 1px solid #e0e0e0; margin-bottom: 16px">
          <button
            type="button"
            onClick={() => setTab('create')}
            style={`flex: 1; padding: 10px; border: none; background: none; cursor: pointer; font-weight: 600; border-bottom: 2px solid ${tab() === 'create' ? '#0d9488' : 'transparent'}; color: ${tab() === 'create' ? '#0d9488' : '#666'}`}
          >Create</button>
          <button
            type="button"
            onClick={() => setTab('edit')}
            style={`flex: 1; padding: 10px; border: none; background: none; cursor: pointer; font-weight: 600; border-bottom: 2px solid ${tab() === 'edit' ? '#0d9488' : 'transparent'}; color: ${tab() === 'edit' ? '#0d9488' : '#666'}`}
          >Edit / Delete</button>
        </div>
        <div class="modal-body">
          <Show when={tab() === 'create'}>
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
                >Cancel</button>
                <button
                  type="button"
                  class="action-btn docker-pull"
                  style="flex: 1"
                  onClick={handleCreate}
                  disabled={!name().trim() || creating()}
                >{creating() ? 'Creating…' : 'Create'}</button>
              </div>
            </div>
          </Show>
          <Show when={tab() === 'edit'}>
            <Show when={props.categories.length === 0}>
              <p style="color: #888; text-align: center; padding: 16px 0">No categories yet.</p>
            </Show>
            <div style="display: flex; flex-direction: column; gap: 8px">
              <For each={props.categories}>{(cat) => (
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #f9f9f9; border-radius: 6px; border: 1px solid #e0e0e0">
                  <Show
                    when={editingName() === cat.name}
                    fallback={
                      <>
                        <span style="flex: 1; font-weight: 500; color: #2c3e50">{cat.name}</span>
                        <span style="color: #888; font-size: 12px">{cat.servers.length} server{cat.servers.length !== 1 ? 's' : ''}</span>
                        <button
                          type="button"
                          class="action-btn"
                          style="padding: 4px 10px; margin: 0"
                          onClick={() => { setEditingName(cat.name); setEditValue(cat.name); }}
                        >Rename</button>
                        <button
                          type="button"
                          class="action-btn"
                          style="padding: 4px 10px; margin: 0; background: #e74c3c; color: white; border-color: #e74c3c"
                          disabled={deletingName() === cat.name}
                          onClick={() => handleDelete(cat.name)}
                        >{deletingName() === cat.name ? '…' : 'Delete'}</button>
                      </>
                    }
                  >
                    <input
                      type="text"
                      class="version-input"
                      style="flex: 1; padding: 6px 10px"
                      value={editValue()}
                      onInput={(e) => setEditValue(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(cat.name);
                        if (e.key === 'Escape') setEditingName(null);
                      }}
                      autofocus
                    />
                    <button
                      type="button"
                      class="action-btn docker-pull"
                      style="padding: 4px 10px; margin: 0"
                      disabled={savingName() === cat.name}
                      onClick={() => handleRename(cat.name)}
                    >{savingName() === cat.name ? '…' : 'Save'}</button>
                    <button
                      type="button"
                      class="action-btn"
                      style="padding: 4px 10px; margin: 0; background: #444; color: white"
                      onClick={() => setEditingName(null)}
                    >Cancel</button>
                  </Show>
                </div>
              )}</For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
