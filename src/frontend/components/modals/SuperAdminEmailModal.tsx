import { createSignal, For } from 'solid-js';
import { Button } from '../ui/Button.tsx';
import { Icon } from '../ui/Icon.tsx';

interface SuperAdminEmailModalProps {
    emails: string[];
    sending: boolean;
    onSend: (emails: string[]) => Promise<void>;
    onClose: () => void;
}

export function SuperAdminEmailModal(p: SuperAdminEmailModalProps) {
    const [excluded, setExcluded] = createSignal<Set<string>>(new Set());

    const toggle = (email: string) => {
        setExcluded(prev => {
            const next = new Set(prev);
            next.has(email) ? next.delete(email) : next.add(email);
            return next;
        });
    };

    const selectedEmails = () => p.emails.filter(e => !excluded().has(e));

    async function handleSend() {
        if (selectedEmails().length === 0 || p.sending) return;
        await p.onSend(selectedEmails());
        p.onClose();
    }

    return (
        <div class="modal-overlay" onClick={p.onClose}>
            <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 480px">
                <div class="modal-header">
                    <h2>Send Weekly Report</h2>
                    <button class="modal-close" onClick={p.onClose}><Icon name="x" /></button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; flex-direction: column; gap: 16px">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                                <p style="font-weight: 600; color: #fff">
                                    Super Admins
                                    <span style="font-weight: 400; color: #94a3b8; margin-left: 6px; font-size: 13px">
                                        (uncheck to exclude)
                                    </span>
                                </p>
                                <div style="display: flex; gap: 8px">
                                    <Button type="button" size="sm" onClick={() => setExcluded(new Set())}>All</Button>
                                    <Button type="button" size="sm" onClick={() => setExcluded(new Set(p.emails))}>None</Button>
                                </div>
                            </div>
                            <div style="max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
                                <For each={p.emails}>
                                    {(email) => (
                                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #cbd5e1">
                                            <input
                                                type="checkbox"
                                                checked={!excluded().has(email)}
                                                onChange={() => toggle(email)}
                                            />
                                            <span>{email}</span>
                                        </label>
                                    )}
                                </For>
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
                                disabled={selectedEmails().length === 0 || p.sending}
                                onClick={handleSend}
                            >
                                {p.sending ? 'Sending…' : `Send to ${selectedEmails().length} admin${selectedEmails().length !== 1 ? 's' : ''}`}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
