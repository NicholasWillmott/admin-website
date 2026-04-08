import { createSignal, For } from 'solid-js';
import type { ClerkUser } from '../../types.ts';

interface SuperAdminEmailModalProps {
    users: ClerkUser[] | undefined;
    sending: boolean;
    onSend: (emails: string[]) => Promise<void>;
    onClose: () => void;
}

function getPrimaryEmail(user: ClerkUser): string {
    return user.email_addresses.find(e => e.id === user.primary_email_address_id)?.email_address ?? '';
}

export function SuperAdminEmailModal(p: SuperAdminEmailModalProps) {
    const superAdmins = () => (p.users ?? []).filter(u => u.public_metadata.isAdmin === true);

    const [excluded, setExcluded] = createSignal<Set<string>>(new Set());

    const toggle = (email: string) => {
        setExcluded(prev => {
            const next = new Set(prev);
            next.has(email) ? next.delete(email) : next.add(email);
            return next;
        });
    };

    const selectedEmails = () => superAdmins()
        .map(u => getPrimaryEmail(u))
        .filter(e => e && !excluded().has(e));

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
                    <button class="modal-close" onClick={p.onClose}>✕</button>
                </div>
                <div class="modal-body">
                    <div style="display: flex; flex-direction: column; gap: 16px">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
                                <p style="font-weight: 600; color: #fff">
                                    Super Admins
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
                                        onClick={() => setExcluded(new Set(superAdmins().map(u => getPrimaryEmail(u))))}
                                    >None</button>
                                </div>
                            </div>
                            <div style="max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
                                {superAdmins().length === 0
                                    ? <p style="color: #666; font-size: 13px">No super admins found.</p>
                                    : (
                                        <For each={superAdmins()}>
                                            {(user) => {
                                                const email = getPrimaryEmail(user);
                                                return (
                                                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #ccc">
                                                        <input
                                                            type="checkbox"
                                                            checked={!excluded().has(email)}
                                                            onChange={() => toggle(email)}
                                                        />
                                                        <img
                                                            src={user.image_url}
                                                            alt=""
                                                            style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover"
                                                        />
                                                        <span>{user.first_name} {user.last_name}</span>
                                                        <span style="color: #666; font-size: 12px">{email}</span>
                                                    </label>
                                                );
                                            }}
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
                                disabled={selectedEmails().length === 0 || p.sending}
                                onClick={handleSend}
                            >
                                {p.sending ? 'Sending...' : `Send to ${selectedEmails().length} Admin${selectedEmails().length !== 1 ? 's' : ''}`}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
