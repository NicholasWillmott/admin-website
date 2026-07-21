import { For, Index, Show, createSignal, onMount } from 'solid-js';
import type { WhatsNewImagePosition, WhatsNewPage, WhatsNewPost } from '../../types.ts';
import { formatDate } from '../../utils.ts';
import {
  createWhatsNewPostApi,
  deleteWhatsNewPostApi,
  fetchChangelogViewApi,
  fetchWhatsNewPostsAdminApi,
  updateWhatsNewPostApi,
  uploadWhatsNewImageApi,
} from '../../services.ts';
import { addToast } from '../../stores/toastStore.ts';
import { WhatsNewPreview } from './WhatsNewPreview.tsx';

interface WhatsNewViewProps {
  getToken: () => Promise<string | null>;
}

interface DraftPost {
  title: string;
  version: string;
  adminsOnly: boolean;
  published: boolean;
  pages: WhatsNewPage[];
}

const IMAGE_POSITIONS: { value: WhatsNewImagePosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

function emptyPage(): WhatsNewPage {
  return { body: '' };
}

export function WhatsNewView(props: WhatsNewViewProps) {
  const [posts, setPosts] = createSignal<WhatsNewPost[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [latestVersion, setLatestVersion] = createSignal('');
  const [selectedId, setSelectedId] = createSignal<string | 'new' | null>(null);
  const [draft, setDraft] = createSignal<DraftPost | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [uploadingPage, setUploadingPage] = createSignal<number | null>(null);

  async function refetch() {
    setLoading(true);
    const token = await props.getToken();
    setPosts(await fetchWhatsNewPostsAdminApi(token));
    setLoading(false);
  }

  onMount(async () => {
    await refetch();
    const token = await props.getToken();
    const changelog = await fetchChangelogViewApi(token);
    setLatestVersion(changelog.versions[0]?.version ?? '');
  });

  function selectPost(post: WhatsNewPost) {
    setSelectedId(post.id);
    setDraft({
      title: post.title,
      version: post.version,
      adminsOnly: post.adminsOnly,
      published: post.published,
      pages: post.pages.map(p => ({ ...p })),
    });
  }

  function newPost() {
    setSelectedId('new');
    setDraft({
      title: '',
      version: latestVersion(),
      adminsOnly: false,
      published: false,
      pages: [emptyPage()],
    });
  }

  function closeEditor() {
    setSelectedId(null);
    setDraft(null);
  }

  function updateDraft(patch: Partial<DraftPost>) {
    setDraft(d => (d ? { ...d, ...patch } : d));
  }

  function updatePage(idx: number, patch: Partial<WhatsNewPage>) {
    setDraft(d => {
      if (!d) return d;
      const pages = d.pages.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      return { ...d, pages };
    });
  }

  function addPage() {
    setDraft(d => (d ? { ...d, pages: [...d.pages, emptyPage()] } : d));
  }

  function removePage(idx: number) {
    const d = draft();
    if (!d) return;
    if (d.pages[idx].body.trim() && !confirm('Delete this page and its content?')) return;
    setDraft({ ...d, pages: d.pages.filter((_, i) => i !== idx) });
  }

  function movePage(idx: number, dir: -1 | 1) {
    setDraft(d => {
      if (!d) return d;
      const target = idx + dir;
      if (target < 0 || target >= d.pages.length) return d;
      const pages = [...d.pages];
      [pages[idx], pages[target]] = [pages[target], pages[idx]];
      return { ...d, pages };
    });
  }

  async function handleUpload(idx: number, file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      addToast('File too large (max 10MB)', 'error');
      return;
    }
    setUploadingPage(idx);
    const token = await props.getToken();
    const result = await uploadWhatsNewImageApi(file, token);
    setUploadingPage(null);
    if (result.success && result.imageUrl) {
      updatePage(idx, { imageUrl: result.imageUrl, imagePosition: draft()?.pages[idx]?.imagePosition ?? 'top' });
    } else {
      addToast(result.error || 'Image upload failed', 'error');
    }
  }

  async function handleSave() {
    const d = draft();
    const id = selectedId();
    if (!d || !id) return;
    if (!d.title.trim()) return addToast('Title is required', 'error');
    if (!/^\d+\.\d+\.\d+$/.test(d.version.trim())) return addToast('Version must be in the form 1.62.0', 'error');
    if (d.pages.length === 0) return addToast('At least one page is required', 'error');
    if (d.pages.some(p => !p.body.trim())) return addToast('Every page needs body text', 'error');

    setSaving(true);
    const token = await props.getToken();
    const payload = { ...d, title: d.title.trim(), version: d.version.trim() };
    const result = id === 'new'
      ? await createWhatsNewPostApi(payload, token)
      : await updateWhatsNewPostApi(id, payload, token);
    setSaving(false);
    if (result.success) {
      addToast(id === 'new' ? 'Post created' : 'Post saved', 'success');
      if (result.post) setSelectedId(result.post.id);
      await refetch();
    } else {
      addToast(result.error || 'Failed to save post', 'error');
    }
  }

  async function handleDelete() {
    const id = selectedId();
    const d = draft();
    if (!id || id === 'new' || !d) return;
    if (!confirm(`Delete the post "${d.title}" and its uploaded images?`)) return;
    const token = await props.getToken();
    const result = await deleteWhatsNewPostApi(id, token);
    if (result.success) {
      addToast('Post deleted', 'success');
      closeEditor();
      await refetch();
    } else {
      addToast(result.error || 'Failed to delete post', 'error');
    }
  }

  return (
    <div class="volume-usage-container">
      <div class="volume-usage-content">
        <div class="volume-usage-header">
          <h2 class="volume-usage-title">What's New</h2>
          <div style="display: flex; gap: 12px">
            <button class="system-btn" onClick={refetch}>Refresh</button>
            <button class="system-btn snapshot" onClick={newPost}>New Post</button>
          </div>
        </div>

        <Show when={loading()}>
          <div class="volume-usage-loading">
            <div class="spinner"></div>
            <p>Loading posts...</p>
          </div>
        </Show>

        <Show when={!loading()}>
          <div class="whats-new-layout">
            <div class="whats-new-list">
              <Show when={posts().length === 0}>
                <p class="whats-new-empty">No posts yet. Create one to announce an update to platform users.</p>
              </Show>
              <For each={posts()}>
                {(post) => (
                  <button
                    type="button"
                    class={`whats-new-list-item ${selectedId() === post.id ? 'active' : ''}`}
                    onClick={() => selectPost(post)}
                  >
                    <div class="whats-new-list-item-top">
                      <span class="whats-new-list-item-title">{post.title}</span>
                      <span class="whats-new-version">v{post.version}</span>
                    </div>
                    <div class="whats-new-list-item-meta">
                      <span class={`whats-new-status ${post.published ? 'published' : 'draft'}`}>
                        {post.published ? 'Published' : 'Draft'}
                      </span>
                      <Show when={post.adminsOnly}>
                        <span class="whats-new-status admins">Admins</span>
                      </Show>
                      <span class="whats-new-list-item-date">{formatDate(post.updatedAt)}</span>
                    </div>
                  </button>
                )}
              </For>
            </div>

            <Show
              when={draft()}
              fallback={
                <div class="whats-new-placeholder">
                  <p>Select a post to edit, or create a new one.</p>
                  <p class="whats-new-hint">
                    Posts are shown to platform users as a popup the first time they log in after
                    their site is updated to the post's version (or later). Page text is written in
                    markdown and rendered by the platform.
                  </p>
                </div>
              }
            >
              {(d) => (
                <div class="whats-new-editor">
                  <div class="whats-new-fields">
                    <div class="whats-new-field" style="flex: 1">
                      <label>Title</label>
                      <input
                        class="modal-input"
                        type="text"
                        placeholder="e.g. New in FASTR"
                        value={d().title}
                        onInput={(e) => updateDraft({ title: e.currentTarget.value })}
                      />
                    </div>
                    <div class="whats-new-field">
                      <label>Platform version</label>
                      <input
                        class="modal-input whats-new-version-input"
                        type="text"
                        placeholder={latestVersion() || '1.62.0'}
                        value={d().version}
                        onInput={(e) => updateDraft({ version: e.currentTarget.value })}
                      />
                    </div>
                    <label class="whats-new-check">
                      <input
                        type="checkbox"
                        checked={d().adminsOnly}
                        onChange={(e) => updateDraft({ adminsOnly: e.currentTarget.checked })}
                      />
                      Admins only
                    </label>
                    <label class="whats-new-check">
                      <input
                        type="checkbox"
                        checked={d().published}
                        onChange={(e) => updateDraft({ published: e.currentTarget.checked })}
                      />
                      Published
                    </label>
                  </div>

                  {/* Index (not For): items are recreated on every keystroke, so
                      identity-keyed For would remount the card and drop focus */}
                  <Index each={d().pages}>
                    {(page, idx) => (
                      <div class="whats-new-page-card">
                        <div class="whats-new-page-header">
                          <span class="whats-new-page-label">Page {idx + 1} of {d().pages.length}</span>
                          <div class="whats-new-page-actions">
                            <button class="system-btn" disabled={idx === 0} onClick={() => movePage(idx, -1)}>↑</button>
                            <button class="system-btn" disabled={idx === d().pages.length - 1} onClick={() => movePage(idx, 1)}>↓</button>
                            <button class="system-btn" disabled={d().pages.length === 1} onClick={() => removePage(idx)}>Delete page</button>
                          </div>
                        </div>
                        <div class="whats-new-page-grid">
                          <div class="whats-new-page-inputs">
                            <div class="whats-new-field">
                              <label>Page heading (optional)</label>
                              <input
                                class="modal-input"
                                type="text"
                                value={page().title ?? ''}
                                onInput={(e) => updatePage(idx, { title: e.currentTarget.value || undefined })}
                              />
                            </div>
                            <div class="whats-new-field">
                              <label>Body (markdown)</label>
                              <textarea
                                class="modal-input whats-new-body-input"
                                rows={8}
                                placeholder={'Describe the change...\n\n- Bullet points work\n- **Bold** and *italic* too'}
                                value={page().body}
                                onInput={(e) => updatePage(idx, { body: e.currentTarget.value })}
                              />
                            </div>
                            <div class="whats-new-field">
                              <label>Image / GIF (optional)</label>
                              <Show
                                when={page().imageUrl}
                                fallback={
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/gif,image/webp"
                                    disabled={uploadingPage() === idx}
                                    onChange={(e) => {
                                      handleUpload(idx, e.currentTarget.files?.[0]);
                                      e.currentTarget.value = '';
                                    }}
                                  />
                                }
                              >
                                <div class="whats-new-image-row">
                                  <img class="whats-new-thumb" src={page().imageUrl} alt="" />
                                  <div class="whats-new-image-controls">
                                    <div class="whats-new-pos-toggle">
                                      <For each={IMAGE_POSITIONS}>
                                        {(pos) => (
                                          <button
                                            type="button"
                                            class={(page().imagePosition ?? 'top') === pos.value ? 'active' : ''}
                                            onClick={() => updatePage(idx, { imagePosition: pos.value })}
                                          >{pos.label}</button>
                                        )}
                                      </For>
                                    </div>
                                    <button
                                      class="system-btn"
                                      onClick={() => updatePage(idx, { imageUrl: undefined, imagePosition: undefined })}
                                    >Remove image</button>
                                  </div>
                                </div>
                              </Show>
                              <Show when={uploadingPage() === idx}>
                                <span class="whats-new-uploading">Uploading…</span>
                              </Show>
                            </div>
                          </div>
                          <div class="whats-new-preview">
                            <div class="whats-new-preview-label">Preview (as it appears in the platform)</div>
                            <WhatsNewPreview
                              postTitle={d().title}
                              page={page()}
                              pageIndex={idx}
                              pageCount={d().pages.length}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </Index>

                  <div class="whats-new-editor-footer">
                    <button class="system-btn" onClick={addPage}>Add page</button>
                    <div style="flex: 1"></div>
                    <Show when={selectedId() !== 'new'}>
                      <button class="action-btn danger" style="margin: 0" onClick={handleDelete}>Delete post</button>
                    </Show>
                    <button class="system-btn" onClick={closeEditor}>Close</button>
                    <button class="system-btn snapshot" disabled={saving()} onClick={handleSave}>
                      {saving() ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
