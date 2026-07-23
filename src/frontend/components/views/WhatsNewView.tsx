import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { WHATS_NEW_LAYOUTS } from '../../types.ts';
import type { WhatsNewLanguage, WhatsNewLayoutPreset, WhatsNewPage, WhatsNewPost, WhatsNewText } from '../../types.ts';
import { formatDate } from '../../utils.ts';
import {
  createWhatsNewPostApi,
  deleteWhatsNewPostApi,
  fetchChangelogViewApi,
  fetchWhatsNewEventLogsApi,
  fetchWhatsNewImagesApi,
  fetchWhatsNewPostsAdminApi,
  updateWhatsNewPostApi,
  uploadWhatsNewImageApi,
} from '../../services.ts';
import type { WhatsNewEventRow, WhatsNewImageInfo } from '../../services.ts';
import { addToast } from '../../stores/toastStore.ts';
import { WhatsNewPreview } from './WhatsNewPreview.tsx';

interface WhatsNewViewProps {
  getToken: () => Promise<string | null>;
}

interface DraftPost {
  title: WhatsNewText;
  version: string;
  adminsOnly: boolean;
  published: boolean;
  publishAt: string; // datetime-local input value; '' = publish immediately
  pages: WhatsNewPage[];
}

const MAX_PAGES = 20;

type MdAction = 'bold' | 'italic' | 'heading' | 'bullet' | 'numbered' | 'link';

const MD_BUTTONS: { action: MdAction; label: string; title: string }[] = [
  { action: 'bold', label: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', title: 'Italic' },
  { action: 'heading', label: 'H', title: 'Heading' },
  { action: 'bullet', label: '•', title: 'Bullet list' },
  { action: 'numbered', label: '1.', title: 'Numbered list' },
  { action: 'link', label: 'Link', title: 'Insert link' },
];

function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function isScheduled(post: WhatsNewPost): boolean {
  return post.published && !!post.publishAt && Date.parse(post.publishAt) > Date.now();
}

function copyPages(pages: WhatsNewPage[]): WhatsNewPage[] {
  return pages.map(p => ({
    ...p,
    ...(p.title ? { title: { ...p.title } } : {}),
    body: { ...p.body },
  }));
}

const PRESETS: { value: WhatsNewLayoutPreset; label: string }[] = [
  { value: 'textOnly', label: 'Text only' },
  { value: 'heroTop', label: 'Hero image' },
  { value: 'imageLeft', label: 'Image left' },
  { value: 'imageRight', label: 'Image right' },
  { value: 'imageBottom', label: 'Image bottom' },
  { value: 'cover', label: 'Cover' },
];

const LANGUAGES: { value: WhatsNewLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'pt', label: 'Português' },
];

function emptyPage(): WhatsNewPage {
  return { body: { en: '' }, layoutPreset: 'textOnly' };
}

// Strips empty fr/pt so the platform falls back to English. Bodies keep
// leading/trailing whitespace (meaningful in markdown); titles are trimmed.
function cleanText(t: WhatsNewText, trim: boolean): WhatsNewText {
  const out: WhatsNewText = { en: trim ? t.en.trim() : t.en };
  if (t.fr?.trim()) out.fr = t.fr;
  if (t.pt?.trim()) out.pt = t.pt;
  return out;
}

// Mini layout diagram for a preset card: shaded block = image, bars = text
function PresetDiagram(p: { preset: WhatsNewLayoutPreset }) {
  const l = WHATS_NEW_LAYOUTS[p.preset];
  return (
    <Show
      when={!l.cover}
      fallback={
        <div class="whats-new-preset-diagram cover">
          <div class="pd-cover-img" />
          <div class="pd-cover-text">
            <div />
            <div />
          </div>
        </div>
      }
    >
      <div class="whats-new-preset-diagram" classList={{ row: l.row }}>
        <Show when={l.hasImage && l.imageFirst}>
          <div class="pd-img" classList={{ side: l.row }} />
        </Show>
        <div class="pd-text">
          <div />
          <div />
          <div />
        </div>
        <Show when={l.hasImage && !l.imageFirst}>
          <div class="pd-img" classList={{ side: l.row }} />
        </Show>
      </div>
    </Show>
  );
}

export function WhatsNewView(props: WhatsNewViewProps) {
  const [posts, setPosts] = createSignal<WhatsNewPost[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [versions, setVersions] = createSignal<string[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | 'new' | null>(null);
  const [draft, setDraft] = createSignal<DraftPost | null>(null);
  const [savedSnapshot, setSavedSnapshot] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [uploadingPage, setUploadingPage] = createSignal<number | null>(null);
  const [editLang, setEditLang] = createSignal<WhatsNewLanguage>('en');
  const [eventRows, setEventRows] = createSignal<WhatsNewEventRow[]>([]);
  const [activePage, setActivePage] = createSignal(0);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerImages, setPickerImages] = createSignal<WhatsNewImageInfo[]>([]);

  let bodyTextareaRef: HTMLTextAreaElement | undefined;

  const latestVersion = () => versions()[0] ?? '';
  const activePageData = () => draft()?.pages[activePage()];

  const isDirty = () => {
    const d = draft();
    if (!d) return false;
    return JSON.stringify(d) !== savedSnapshot();
  };
  const confirmDiscard = () => !isDirty() || confirm('Discard unsaved changes?');

  const langText = (t: WhatsNewText | undefined): string => t?.[editLang()] ?? '';
  const setLangText = (t: WhatsNewText | undefined, value: string): WhatsNewText =>
    ({ en: '', ...(t ?? {}), [editLang()]: value });
  // A language "has content" when the post title, any page body, or any page heading is written in it
  const langHasContent = (lang: WhatsNewLanguage): boolean => {
    const d = draft();
    if (!d) return false;
    return !!d.title[lang]?.trim() ||
      d.pages.some(p => !!p.body[lang]?.trim() || !!p.title?.[lang]?.trim());
  };

  // Unique users per event across the fleet (same email on two instances = two users)
  const postStats = (postId: string) => {
    const sets = { seen: new Set<string>(), skipped: new Set<string>(), completed: new Set<string>() };
    for (const row of eventRows()) {
      if (row.postId === postId) sets[row.event].add(`${row.serverId}:${row.userEmail}`);
    }
    return { seen: sets.seen.size, skipped: sets.skipped.size, completed: sets.completed.size };
  };

  async function refetch() {
    setLoading(true);
    const token = await props.getToken();
    setPosts(await fetchWhatsNewPostsAdminApi(token));
    setLoading(false);
  }

  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (isDirty()) e.preventDefault();
  };

  onMount(async () => {
    window.addEventListener('beforeunload', handleBeforeUnload);
    await refetch();
    const token = await props.getToken();
    fetchWhatsNewEventLogsApi(token).then(setEventRows);
    const changelog = await fetchChangelogViewApi(token);
    setVersions(changelog.versions.slice(0, 10).map(v => v.version));
  });

  onCleanup(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  function draftOf(post: WhatsNewPost): DraftPost {
    return {
      title: { ...post.title },
      version: post.version,
      adminsOnly: post.adminsOnly,
      published: post.published,
      publishAt: isoToLocalInput(post.publishAt),
      pages: copyPages(post.pages),
    };
  }

  function selectPost(post: WhatsNewPost) {
    const d = draftOf(post);
    setSelectedId(post.id);
    setDraft(d);
    setSavedSnapshot(JSON.stringify(d));
    setActivePage(0);
    setPickerOpen(false);
  }

  function newPost() {
    if (!confirmDiscard()) return;
    const d: DraftPost = {
      title: { en: '' },
      version: latestVersion(),
      adminsOnly: false,
      published: false,
      publishAt: '',
      pages: [emptyPage()],
    };
    setSelectedId('new');
    setDraft(d);
    setSavedSnapshot(JSON.stringify(d));
    setActivePage(0);
    setPickerOpen(false);
  }

  // Start the next release's post from the current one; shares image files
  // with the original (the backend only deletes files no post references)
  function duplicatePost() {
    const d = draft();
    if (!d) return;
    setSelectedId('new');
    setDraft({
      title: { ...d.title, en: `${d.title.en} (copy)` },
      version: latestVersion() || d.version,
      adminsOnly: d.adminsOnly,
      published: false,
      publishAt: '',
      pages: copyPages(d.pages),
    });
    setSavedSnapshot(null); // a duplicate is unsaved by definition
    setActivePage(0);
    addToast('Duplicated as a new draft — save to keep it', 'success');
  }

  function closeEditor() {
    if (!confirmDiscard()) return;
    setSelectedId(null);
    setDraft(null);
    setSavedSnapshot(null);
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
    const d = draft();
    if (!d || d.pages.length >= MAX_PAGES) return;
    setDraft({ ...d, pages: [...d.pages, emptyPage()] });
    setActivePage(d.pages.length);
    setPickerOpen(false);
  }

  function removePage(idx: number) {
    const d = draft();
    if (!d) return;
    const hasContent = LANGUAGES.some(l => !!d.pages[idx].body[l.value]?.trim());
    if (hasContent && !confirm('Delete this page and its content?')) return;
    setDraft({ ...d, pages: d.pages.filter((_, i) => i !== idx) });
    setActivePage(Math.max(0, Math.min(activePage(), d.pages.length - 2)));
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
    const target = idx + dir;
    const d = draft();
    if (d && target >= 0 && target < d.pages.length) setActivePage(target);
  }

  async function handleUpload(idx: number, file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      addToast('File too large (max 10MB)', 'error');
      return;
    }
    setUploadingPage(idx);
    try {
      const token = await props.getToken();
      const result = await uploadWhatsNewImageApi(file, token);
      if (result.success && result.imageUrl) {
        updatePage(idx, { imageUrl: result.imageUrl });
      } else {
        addToast(result.error || 'Image upload failed', 'error');
      }
    } finally {
      setUploadingPage(null);
    }
  }

  async function openImagePicker() {
    const token = await props.getToken();
    setPickerImages(await fetchWhatsNewImagesApi(token));
    setPickerOpen(true);
  }

  // Wraps the selection (bold/italic/link) or prefixes the selected lines
  // (heading/lists) in the body textarea, then restores focus + selection
  function applyMarkdown(action: MdAction) {
    const ta = bodyTextareaRef;
    const pg = activePageData();
    if (!ta || !pg) return;
    const value = ta.value;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    let next: string;
    let selStart: number;
    let selEnd: number;
    if (action === 'bold' || action === 'italic' || action === 'link') {
      const sel = value.slice(start, end);
      const insert = action === 'bold'
        ? `**${sel || 'bold text'}**`
        : action === 'italic'
          ? `*${sel || 'italic text'}*`
          : `[${sel || 'link text'}](https://)`;
      next = value.slice(0, start) + insert + value.slice(end);
      selStart = start;
      selEnd = start + insert.length;
    } else {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lineEndIdx = value.indexOf('\n', end);
      const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const block = value.slice(lineStart, lineEnd);
      const prefixed = block.split('\n').map((line, i) =>
        action === 'heading' ? `## ${line}` : action === 'bullet' ? `- ${line}` : `${i + 1}. ${line}`
      ).join('\n');
      next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
      selStart = lineStart;
      selEnd = lineStart + prefixed.length;
    }
    updatePage(activePage(), { body: setLangText(pg.body, next) });
    queueMicrotask(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  }

  async function handleSave() {
    const d = draft();
    const id = selectedId();
    if (!d || !id) return;
    if (!d.title.en.trim()) {
      setEditLang('en');
      return addToast('Title needs an English version (other languages fall back to it)', 'error');
    }
    if (!/^\d+\.\d+\.\d+$/.test(d.version.trim())) return addToast('Version must be in the form 1.62.0', 'error');
    if (d.pages.length === 0) return addToast('At least one page is required', 'error');
    if (d.pages.some(p => !p.body.en.trim())) {
      setEditLang('en');
      return addToast('Every page needs English body text (other languages fall back to it)', 'error');
    }
    if (d.pages.some(p => p.title && !p.title.en.trim() && (p.title.fr?.trim() || p.title.pt?.trim()))) {
      setEditLang('en');
      return addToast('Page headings need an English version (other languages fall back to it)', 'error');
    }
    if (d.pages.some(p => p.layoutPreset !== 'textOnly' && !p.imageUrl)) {
      return addToast('Image layouts need an uploaded image — upload one or choose Text only', 'error');
    }
    if (d.publishAt && !localInputToIso(d.publishAt)) {
      return addToast('Invalid publish date', 'error');
    }

    setSaving(true);
    try {
      const token = await props.getToken();
      const payload = {
        title: cleanText(d.title, true),
        version: d.version.trim(),
        adminsOnly: d.adminsOnly,
        published: d.published,
        publishAt: localInputToIso(d.publishAt),
        pages: d.pages.map(p => {
          const needsImage = p.layoutPreset !== 'textOnly';
          const page: WhatsNewPage = {
            body: cleanText(p.body, false),
            layoutPreset: p.layoutPreset,
            // Text-only pages keep any uploaded image in the draft (so switching
            // preset back restores it) but never persist it
            ...(needsImage && p.imageUrl ? { imageUrl: p.imageUrl } : {}),
          };
          if (p.title?.en.trim()) page.title = cleanText(p.title, true);
          return page;
        }),
      };
      const result = id === 'new'
        ? await createWhatsNewPostApi(payload, token)
        : await updateWhatsNewPostApi(id, payload, token);
      if (result.success) {
        addToast(id === 'new' ? 'Post created' : 'Post saved', 'success');
        if (result.post) {
          const keepPage = activePage();
          selectPost(result.post);
          setActivePage(Math.min(keepPage, result.post.pages.length - 1));
        }
        await refetch();
      } else {
        addToast(result.error || 'Failed to save post', 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const id = selectedId();
    const d = draft();
    if (!id || id === 'new' || !d) return;
    if (!confirm(`Delete the post "${d.title.en}" and its uploaded images?`)) return;
    const token = await props.getToken();
    const result = await deleteWhatsNewPostApi(id, token);
    if (result.success) {
      addToast('Post deleted', 'success');
      setSelectedId(null);
      setDraft(null);
      setSavedSnapshot(null);
      await refetch();
    } else {
      addToast(result.error || 'Failed to delete post', 'error');
    }
  }

  return (
    <div class="volume-usage-container">
      <div class="volume-usage-content whats-new-wide">
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
                    onClick={() => {
                      if (selectedId() === post.id) return;
                      if (confirmDiscard()) selectPost(post);
                    }}
                  >
                    <div class="whats-new-list-item-top">
                      <span class="whats-new-list-item-title">{post.title.en}</span>
                      <span class="whats-new-version">v{post.version}</span>
                    </div>
                    <div class="whats-new-list-item-meta">
                      <span class={`whats-new-status ${isScheduled(post) ? 'scheduled' : post.published ? 'published' : 'draft'}`}>
                        {isScheduled(post) ? 'Scheduled' : post.published ? 'Published' : 'Draft'}
                      </span>
                      <Show when={post.adminsOnly}>
                        <span class="whats-new-status admins">Admins</span>
                      </Show>
                      <span class="whats-new-list-item-date">{formatDate(post.updatedAt)}</span>
                    </div>
                    <div class="whats-new-list-item-stats">
                      {(() => {
                        const s = postStats(post.id);
                        return `Seen ${s.seen} · Skipped ${s.skipped} · Completed ${s.completed}`;
                      })()}
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
                  <div class="whats-new-section-label">Post settings</div>
                  <div class="whats-new-fields">
                    <div class="whats-new-field" style="flex: 1">
                      <label>Title</label>
                      <input
                        class="modal-input"
                        type="text"
                        placeholder={editLang() === 'en' ? 'e.g. New in FASTR' : d().title.en || 'e.g. New in FASTR'}
                        value={langText(d().title)}
                        onInput={(e) => updateDraft({ title: setLangText(d().title, e.currentTarget.value) })}
                      />
                    </div>
                    <div class="whats-new-field">
                      <label>Platform version</label>
                      <input
                        list="wn-version-options"
                        class="modal-input whats-new-version-input"
                        type="text"
                        placeholder={latestVersion() || '1.62.0'}
                        value={d().version}
                        onInput={(e) => updateDraft({ version: e.currentTarget.value })}
                      />
                      <datalist id="wn-version-options">
                        <For each={versions()}>{(v) => <option value={v} />}</For>
                      </datalist>
                    </div>
                    <div class="whats-new-field">
                      <label>Publish at (optional)</label>
                      <input
                        class="modal-input"
                        type="datetime-local"
                        value={d().publishAt}
                        onInput={(e) => updateDraft({ publishAt: e.currentTarget.value })}
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

                  <div class="whats-new-lang-row">
                    <div class="whats-new-pos-toggle">
                      <For each={LANGUAGES}>
                        {(lang) => (
                          <button
                            type="button"
                            class={editLang() === lang.value ? 'active' : ''}
                            onClick={() => setEditLang(lang.value)}
                          >
                            {lang.label}
                            {langHasContent(lang.value) ? ' ✓' : ''}
                          </button>
                        )}
                      </For>
                    </div>
                    <span class="whats-new-lang-hint">
                      Text fields edit the selected language. French/Portuguese fall back to English when left empty.
                    </span>
                  </div>

                  <div class="whats-new-section-label whats-new-section-gap">Pages</div>
                  <div class="whats-new-page-tabs">
                    <For each={d().pages}>
                      {(_, i) => (
                        <button
                          type="button"
                          classList={{ active: activePage() === i() }}
                          onClick={() => setActivePage(i())}
                        >
                          Page {i() + 1}
                        </button>
                      )}
                    </For>
                    <button
                      type="button"
                      class="add"
                      title="Add page"
                      disabled={d().pages.length >= MAX_PAGES || uploadingPage() !== null}
                      onClick={addPage}
                    >+</button>
                  </div>

                  <div class="whats-new-editor-grid">
                    <Show when={activePageData()}>
                      {(pg) => (
                        <div class="whats-new-page-card whats-new-page-fields">
                          <div class="whats-new-page-header">
                            <span class="whats-new-page-label">Page {activePage() + 1} of {d().pages.length}</span>
                            {/* Structural changes are locked during an upload — the in-flight
                                upload targets a page index that a move/delete would invalidate */}
                            <div class="whats-new-page-actions">
                              <button class="system-btn" disabled={activePage() === 0 || uploadingPage() !== null} onClick={() => movePage(activePage(), -1)}>↑</button>
                              <button class="system-btn" disabled={activePage() === d().pages.length - 1 || uploadingPage() !== null} onClick={() => movePage(activePage(), 1)}>↓</button>
                              <button class="system-btn" disabled={d().pages.length === 1 || uploadingPage() !== null} onClick={() => removePage(activePage())}>Delete page</button>
                            </div>
                          </div>
                          <div class="whats-new-page-inputs">
                            <div class="whats-new-field">
                              <label>Page heading (optional)</label>
                              <input
                                class="modal-input"
                                type="text"
                                placeholder={editLang() !== 'en' ? pg().title?.en ?? '' : ''}
                                value={langText(pg().title)}
                                onInput={(e) => updatePage(activePage(), { title: setLangText(pg().title, e.currentTarget.value) })}
                              />
                            </div>
                            <div class="whats-new-field">
                              <label>Body (markdown)</label>
                              <div class="whats-new-md-toolbar">
                                <For each={MD_BUTTONS}>
                                  {(btn) => (
                                    <button type="button" title={btn.title} onClick={() => applyMarkdown(btn.action)}>
                                      {btn.label}
                                    </button>
                                  )}
                                </For>
                              </div>
                              <textarea
                                ref={bodyTextareaRef}
                                class="modal-input whats-new-body-input"
                                rows={10}
                                placeholder={
                                  editLang() !== 'en' && pg().body.en
                                    ? pg().body.en
                                    : 'Describe the change...\n\n- Bullet points work\n- **Bold** and *italic* too'
                                }
                                value={langText(pg().body)}
                                onInput={(e) => updatePage(activePage(), { body: setLangText(pg().body, e.currentTarget.value) })}
                              />
                            </div>
                            <div class="whats-new-field">
                              <label>Page layout</label>
                              <div class="whats-new-preset-cards">
                                <For each={PRESETS}>
                                  {(preset) => (
                                    <button
                                      type="button"
                                      class="whats-new-preset-card"
                                      classList={{ active: pg().layoutPreset === preset.value }}
                                      onClick={() => updatePage(activePage(), { layoutPreset: preset.value })}
                                    >
                                      <PresetDiagram preset={preset.value} />
                                      <span>{preset.label}</span>
                                    </button>
                                  )}
                                </For>
                              </div>
                            </div>
                            <Show when={WHATS_NEW_LAYOUTS[pg().layoutPreset].hasImage}>
                              <div class="whats-new-field">
                                <label>Image / GIF</label>
                                <Show
                                  when={pg().imageUrl}
                                  fallback={
                                    <div class="whats-new-picker-row">
                                      <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/gif,image/webp"
                                        disabled={uploadingPage() === activePage()}
                                        onChange={(e) => {
                                          handleUpload(activePage(), e.currentTarget.files?.[0]);
                                          e.currentTarget.value = '';
                                        }}
                                      />
                                      <button class="system-btn" onClick={openImagePicker}>Choose existing</button>
                                    </div>
                                  }
                                >
                                  <div class="whats-new-image-row">
                                    <img class="whats-new-thumb" src={pg().imageUrl} alt="" />
                                    <button
                                      class="system-btn"
                                      onClick={() => updatePage(activePage(), { imageUrl: undefined })}
                                    >Remove image</button>
                                  </div>
                                </Show>
                                <Show when={pickerOpen()}>
                                  <div class="whats-new-image-picker">
                                    <Show when={pickerImages().length === 0}>
                                      <span class="whats-new-uploading">No uploaded images available</span>
                                    </Show>
                                    <For each={pickerImages()}>
                                      {(img) => (
                                        <button
                                          type="button"
                                          class="whats-new-image-pick"
                                          title={img.filename}
                                          onClick={() => {
                                            updatePage(activePage(), { imageUrl: img.url });
                                            setPickerOpen(false);
                                          }}
                                        >
                                          <img src={img.url} alt="" />
                                        </button>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                                <Show when={uploadingPage() === activePage()}>
                                  <span class="whats-new-uploading">Uploading…</span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        </div>
                      )}
                    </Show>
                    <div class="whats-new-preview">
                      <div class="whats-new-preview-label">Preview (as it appears in the platform)</div>
                      <Show when={activePageData()}>
                        {(pg) => (
                          <WhatsNewPreview
                            postTitle={d().title}
                            page={pg()}
                            pageIndex={activePage()}
                            pageCount={d().pages.length}
                            lang={editLang()}
                          />
                        )}
                      </Show>
                    </div>
                  </div>

                  <div class="whats-new-editor-footer">
                    <Show when={selectedId() !== 'new'}>
                      <button class="system-btn" onClick={duplicatePost}>Duplicate</button>
                      <button class="action-btn danger" style="margin: 0" onClick={handleDelete}>Delete post</button>
                    </Show>
                    <div style="flex: 1"></div>
                    <button class="system-btn" onClick={closeEditor}>Close</button>
                    <button
                      class="system-btn snapshot"
                      classList={{ 'whats-new-save-dirty': isDirty() }}
                      disabled={saving()}
                      onClick={handleSave}
                    >
                      {saving() ? 'Saving…' : isDirty() ? 'Save •' : 'Save'}
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
