import { createSignal, For } from 'solid-js';
import type { Server } from '../../types.ts';

interface InstanceAdminEmailModalProps {
    servers: Server[] | undefined;
    sending: boolean;
    onSend: (serverIds: string[]) => Promise<void>;
    onClose: () => void;
}

export function InstanceAdminEmailModal(p: InstanceAdminEmailModalProps) {
    const allIds = () => (p.servers ?? []).map(s => s.id);

    const [excluded, setExcluded] = createSignal<Set<string>>(new Set());

    const toggle = (id: string) => {
        setExcluded(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const selectedIds = () => allIds().filter(id => !excluded().has(id));

    async function handleSend() {
        if (selectedIds().length === 0 || p.sending) return;
        await p.onSend(selectedIds());
        p.onClose();
    }

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 480px">
                <div class="modal-header">
                    <h2>Send Instance Admin Reports</h2>
                    <button class="modal-close" onClick={p.onClose}>✕</button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; flex-direction: column; gap: 16px">
                        <p style="color: #aaa; font-size: 13px; margin: 0">
                            Select which instances to send admin reports to. Each report goes to that instance's admin users.
                        </p>

                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                                <p style="font-weight: 600; color: #fff">
                                    Instances
                                    <span style="font-weight: 400; color: #aaa; margin-left: 6px; font-size: 13px">
                                        (uncheck to exclude)
                                    </span>
                                </p>
                                <div style="display: flex; gap: 8px">
                                    <button
                                        type="button"
                                        class="activity-btn"
                                        onClick={() => setExcluded(new Set())}
                                    >All</button>
                                    <button
                                        type="button"
                                        class="activity-btn"
                                        onClick={() => setExcluded(new Set(allIds()))}
                                    >None</button>
                                </div>
                            </div>
                            <div style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
                                {(p.servers ?? []).length === 0
                                    ? <p style="color: #666; font-size: 13px">No instances found.</p>
                                    : (
                                        <For each={p.servers ?? []}>
                                            {(server) => (
                                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #ccc">
                                                    <input
                                                        type="checkbox"
                                                        checked={!excluded().has(server.id)}
                                                        onChange={() => toggle(server.id)}
                                                    />
                                                    <span>{server.label}</span>
                                                    <span style="color: #666; font-size: 12px">({server.id})</span>
                                                </label>
                                            )}
                                        </For>
                                    )
                                }
                            </div>
                        </div>

                        <div style="display: flex; gap: 8px; margin-top: 4px">
                            <button
                                type="button"
                                class="action-btn"
                                style="flex: 1; background: #444; color: #fff"
                                onClick={p.onClose}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                class="action-btn"
                                style="flex: 1"
                                disabled={selectedIds().length === 0 || p.sending}
                                onClick={handleSend}
                            >
                                {p.sending ? 'Sending...' : `Send to ${selectedIds().length} Instance${selectedIds().length !== 1 ? 's' : ''}`}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
