import { createSignal, For } from 'solid-js';
import type { Server } from '../../types.ts';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';

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
                    <button class="modal-close" onClick={p.onClose}><Icon name="x" /></button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; flex-direction: column; gap: 16px">
                        <p style="color: #94a3b8; font-size: 13px; margin: 0">
                            Select which instances to send admin reports to. Each report goes to that instance's admin users.
                        </p>

                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                                <p style="font-weight: 600; color: #fff">
                                    Instances
                                    <span style="font-weight: 400; color: #94a3b8; margin-left: 6px; font-size: 13px">
                                        (uncheck to exclude)
                                    </span>
                                </p>
                                <div style="display: flex; gap: 8px">
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => setExcluded(new Set())}
                                    >All</Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => setExcluded(new Set(allIds()))}
                                    >None</Button>
                                </div>
                            </div>
                            <div style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
                                {(p.servers ?? []).length === 0
                                    ? <p style="color: #94a3b8; font-size: 13px">No instances found.</p>
                                    : (
                                        <For each={p.servers ?? []}>
                                            {(server) => (
                                                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #cbd5e1">
                                                    <input
                                                        type="checkbox"
                                                        checked={!excluded().has(server.id)}
                                                        onChange={() => toggle(server.id)}
                                                    />
                                                    <span>{server.label}</span>
                                                    <span style="color: #94a3b8; font-size: 12px">({server.id})</span>
                                                </label>
                                            )}
                                        </For>
                                    )
                                }
                            </div>
                        </div>

                        <div style="display: flex; gap: 8px; margin-top: 4px">
                            <Button
                                type="button"
                                block
                                onClick={p.onClose}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                icon="send"
                                block
                                loading={p.sending}
                                disabled={selectedIds().length === 0 || p.sending}
                                onClick={handleSend}
                            >
                                {p.sending ? 'Sending…' : `Send to ${selectedIds().length} instance${selectedIds().length !== 1 ? 's' : ''}`}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
