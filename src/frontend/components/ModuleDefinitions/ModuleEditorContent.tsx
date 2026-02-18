import { useAuth } from "clerk-solidjs";
import { createResource, createSignal, For, Show } from "solid-js";
import { VizPresetFormEditor } from "./VizPresetFormEditor.tsx";
import { MonacoEditor } from "./MonacoEditor.tsx";

const API_BASE = import.meta.env.VITE_API_BASE || "https://status-api.fastr-analytics.org";

interface ModuleInfo {
    moduleId: string;
    label: string;
    filename: string;
    vizPresetsCount: number;
}

interface PendingChange {
    moduleId: string;
    newContent: string;
}

export function ModuleEditorContent() {
    const { getToken } = useAuth()

    // State
    const [selectedModuleId, setSelectedModuleId] = createSignal<string | null>(null);
    const [fileContent, setFileContent] = createSignal<string>("");
    const [originalContent, setOriginalContent] = createSignal<string>("");
    const [editorView, setEditorView] = createSignal<"code" | "form">("code");
    const [pendingChanges, setPendingChanges] = createSignal<PendingChange[]>([]);
    const [commitMessage, setCommitMessage] = createSignal("");
    const [committing, setCommitting] = createSignal(false);

    // Per-module content cache in localStorage to persist edits across module switches and page refreshes
    const CACHE_PREFIX = "module-editor:";
    function cacheGet(moduleId: string): { fileContent: string; originalContent: string } | null {
        const raw = localStorage.getItem(CACHE_PREFIX + moduleId);
        return raw ? JSON.parse(raw) : null;
    }
    function cacheSet(moduleId: string, fc: string, oc: string) {
        localStorage.setItem(CACHE_PREFIX + moduleId, JSON.stringify({ fileContent: fc, originalContent: oc }));
    }
    function cacheClear(moduleId: string) {
        localStorage.removeItem(CACHE_PREFIX + moduleId);
    }

    // Fetch module list
    const [modules] = createResource(async () => {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/module-definitions`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        return json.data as ModuleInfo[];
    });

    // Load a module's file content (restores from cache if available)
    async function loadModule(moduleId: string) {
        // Save current module's content to cache before switching
        const currentId = selectedModuleId();
        if (currentId) {
            cacheSet(currentId, fileContent(), originalContent());
        }

        setSelectedModuleId(moduleId);

        // Restore from cache if available
        const cached = cacheGet(moduleId);
        if (cached) {
            setFileContent(cached.fileContent);
            setOriginalContent(cached.originalContent);
            return;
        }

        // Fetch from API only if not cached
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/module-definitions/${moduleId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        setFileContent(json.data.content);
        setOriginalContent(json.data.content);
    }

    // Stage current changes
    function stageChanges() {
        const modId = selectedModuleId();
        if (!modId) return;
        if (fileContent() === originalContent()) return;

        setPendingChanges((prev) => {
            // Replace if already staged for this module, otherwise add
            const filtered = prev.filter((c) => c.moduleId !== modId);
            return [...filtered, { moduleId: modId, newContent: fileContent() }];
        });
        setOriginalContent(fileContent());
        cacheSet(modId, fileContent(), originalContent());
    }

    // Commit all pending changes
    async function commitChanges() {
        if (pendingChanges().length === 0 || !commitMessage().trim()) return;
        setCommitting(true);
        try {
            const token = await getToken();
            const res = await fetch(`${API_BASE}/api/module-definitions/commit`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    changes: pendingChanges(),
                    commitMessage: commitMessage(),
                }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            // Clear cache for committed modules so next load fetches fresh content
            for (const change of pendingChanges()) {
                cacheClear(change.moduleId);
            }
            setPendingChanges([]);
            setCommitMessage("");
            // Re-fetch current module to get the committed state
            const currentId = selectedModuleId();
            if (currentId) {
                const freshRes = await fetch(`${API_BASE}/api/module-definitions/${currentId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const freshJson = await freshRes.json();
                if (freshJson.success) {
                    setFileContent(freshJson.data.content);
                    setOriginalContent(freshJson.data.content);
                }
            }
            alert(`Committed successfully! SHA: ${json.data.commitSha}`);
        } catch (error) {
            alert(`Commit failed: ${error}`);
        } finally {
            setCommitting(false);
        }
    }

    const isDirty = () => fileContent() !== originalContent();

    return (
        <div class="module-editor-layout">
            {/* Sidebar */}
            <div class="module-editor-sidebar">
                <h3>Modules</h3>
                <Show when={modules()} fallback={<p>Loading modules...</p>}>
                    <For each={modules()}>
                        {(mod) => (
                            <button
                                class="module-list-item"
                                data-selected={selectedModuleId() === mod.moduleId}
                                onClick={() => loadModule(mod.moduleId)}
                            >
                                <strong>{mod.moduleId}</strong>
                                <span>{mod.label}</span>
                                <small>Viz presets: {mod.vizPresetsCount}</small>
                            </button>
                        )}
                    </For>
                </Show>
            </div>

            {/* Main area */}
            <div class="module-editor-main">
                <Show when={selectedModuleId()} fallback={
                    <div class="module-editor-placeholder">Select a module to edit</div>
                }>
                    {/* Toolebar */}
                    <div class="module-editor-toolbar">
                        <div class="editor-view-toggle">
                            <button
                                data-selected={editorView() === "code"}
                                onClick={() => setEditorView("code")}
                            >
                                Code
                            </button>
                            <button
                                data-selected={editorView() === "form"}
                                onClick={() => setEditorView("form")}
                            >
                                Form
                            </button>
                        </div>
                        <div>
                            <Show when={isDirty()}>
                                <button 
                                    class="stage-btn" 
                                    onClick={stageChanges}
                                >
                                    Stage Changes
                                </button>
                            </Show>
                        </div>
                    </div>

                    {/* Editor */}
                    <div class="module-editor-content-area">
                        <Show when={editorView() === "code"}>
                            <MonacoEditor
                                language="typescript"
                                value={fileContent}
                                onChange={setFileContent}
                            />
                        </Show>
                        <Show when={editorView() === "form"}>
                            <VizPresetFormEditor
                                fileContent={fileContent()}
                                onFileContentChange={setFileContent}
                            />
                        </Show>
                    </div>

                    {/* Commit panel */}
                    <div class="module-editor-commit-panel">
                        <div class="pending-changes-info">
                            {pendingChanges().length} staged change(s)
                            <Show when={pendingChanges().length > 0}>
                                <For each={pendingChanges()}>
                                    {(c) => <span class="pending-badge">{c.moduleId}</span>}
                                </For>
                            </Show>
                        </div>
                        <div class="commit-controls">
                            <input
                                type="text"
                                placeholder="Commit message..."
                                value={commitMessage()}
                                onInput={(e) => setCommitMessage(e.currentTarget.value)}
                            />
                            <button
                                class="commit-btn"
                                onClick={commitChanges}
                                disabled={pendingChanges().length === 0 || !commitMessage().trim() || committing()}
                            >
                                {committing() ? "Committing..." : "Commit to GitHub"}
                            </button>
                            <Show when={pendingChanges().length > 0}>
                                <button class="discard-btn" onClick={() => setPendingChanges([])}>Discard All</button>
                            </Show>
                        </div>
                    </div>
                </Show>
            </div>
        </div>
    );
}