import { For, Show, createMemo, createSignal } from 'solid-js';
import { addToast } from '../../stores/toastStore.ts';
import { grantAdminApi, inviteAdminApi } from '../../services.ts';
import type { ClerkUser } from '../../types.ts';

interface AddAdminModalProps {
  onClose: () => void;
  onChanged: () => void;
  getToken: () => Promise<string | null>;
  allUsers: ClerkUser[] | undefined;
  adminIds: Set<string>;
  pendingInviteEmails: Set<string>;
}

const primaryEmail = (user: ClerkUser): string => {
  const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
  return primary?.email_address ?? '—';
};

const displayName = (user: ClerkUser): string => {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || user.username || '—';
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddAdminModal(props: AddAdminModalProps) {
  const [tab, setTab] = createSignal<'existing' | 'invite'>('existing');

  // Existing user tab state
  const [search, setSearch] = createSignal('');
  const [grantingId, setGrantingId] = createSignal<string | null>(null);

  // Invite tab state
  const [email, setEmail] = createSignal('');
  const [inviting, setInviting] = createSignal(false);

  const matches = createMemo(() => {
    const q = search().trim().toLowerCase();
    if (!q) return [];
    return (props.allUsers ?? [])
      .filter(u => !props.adminIds.has(u.id))
      .filter(u =>
        primaryEmail(u).toLowerCase().includes(q) ||
        displayName(u).toLowerCase().includes(q)
      )
      .slice(0, 8);
  });

  const existingUserForEmail = createMemo(() => {
    const e = email().trim().toLowerCase();
    if (!e) return null;
    return (props.allUsers ?? []).find(u => primaryEmail(u).toLowerCase() === e) ?? null;
  });

  const alreadyInvited = createMemo(() => props.pendingInviteEmails.has(email().trim().toLowerCase()));
  const emailValid = () => EMAIL_RE.test(email().trim());
  const canInvite = () => emailValid() && !existingUserForEmail() && !alreadyInvited() && !inviting();

  const handleGrant = async (user: ClerkUser) => {
    setGrantingId(user.id);
    const token = await props.getToken();
    const result = await grantAdminApi(user.id, token);
    setGrantingId(null);
    if (result.success) {
      addToast(`${primaryEmail(user)} now has admin access`, 'success');
      props.onChanged();
    } else {
      addToast(result.error || 'Failed to grant access', 'error');
    }
  };

  const handleInvite = async () => {
    if (!canInvite()) return;
    const trimmed = email().trim();
    setInviting(true);
    const token = await props.getToken();
    const result = await inviteAdminApi(trimmed, token);
    setInviting(false);
    if (result.success) {
      addToast(`Invitation sent to ${trimmed}`, 'success');
      setEmail('');
      props.onChanged();
    } else {
      addToast(result.error || 'Failed to send invitation', 'error');
    }
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 520px">
        <div class="modal-header">
          <h2>Add Person</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div style="display: flex; border-bottom: 1px solid rgba(255, 255, 255, 0.1); margin-bottom: 16px">
          <button
            type="button"
            onClick={() => setTab('existing')}
            style={`flex: 1; padding: 10px; border: none; background: none; cursor: pointer; font-weight: 600; border-bottom: 2px solid ${tab() === 'existing' ? '#0d9488' : 'transparent'}; color: ${tab() === 'existing' ? '#0d9488' : '#94a3b8'}`}
          >Existing User</button>
          <button
            type="button"
            onClick={() => setTab('invite')}
            style={`flex: 1; padding: 10px; border: none; background: none; cursor: pointer; font-weight: 600; border-bottom: 2px solid ${tab() === 'invite' ? '#0d9488' : 'transparent'}; color: ${tab() === 'invite' ? '#0d9488' : '#94a3b8'}`}
          >Invite by Email</button>
        </div>
        <div class="modal-body">
          <Show when={tab() === 'existing'}>
            <div class="docker-pull-form">
              <label for="aa-search">Search Platform Users</label>
              <input
                id="aa-search"
                type="text"
                class="version-input"
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                placeholder="Name or email..."
                autofocus
              />
            </div>
            <Show when={!props.allUsers}>
              <p style="color: #94a3b8; text-align: center; padding: 16px 0">Loading users…</p>
            </Show>
            <Show when={props.allUsers && !search().trim()}>
              <p style="color: #94a3b8; font-size: 13px; padding: 12px 0 4px">
                Search for someone with an existing account to give them access to this admin website.
              </p>
            </Show>
            <Show when={props.allUsers && search().trim() && matches().length === 0}>
              <p style="color: #94a3b8; text-align: center; padding: 16px 0">
                No matching users without access found.
              </p>
            </Show>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px">
              <For each={matches()}>{(user) => (
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(255, 255, 255, 0.06); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1)">
                  <div style="flex: 1; min-width: 0">
                    <div style="font-weight: 500; color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{displayName(user)}</div>
                    <div style="color: #94a3b8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{primaryEmail(user)}</div>
                  </div>
                  <button
                    type="button"
                    class="action-btn docker-pull"
                    style="padding: 6px 14px; margin: 0; flex-shrink: 0"
                    disabled={grantingId() === user.id}
                    onClick={() => handleGrant(user)}
                  >{grantingId() === user.id ? 'Granting…' : 'Grant Access'}</button>
                </div>
              )}</For>
            </div>
          </Show>

          <Show when={tab() === 'invite'}>
            <div class="docker-pull-form">
              <label for="aa-email">Email Address</label>
              <input
                id="aa-email"
                type="email"
                class="version-input"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
                placeholder="person@example.com"
                autofocus
              />
              <p style="color: #94a3b8; font-size: 13px; margin: 10px 0 0">
                They'll receive a sign-up link by email and will have admin access as soon as they finish signing up.
              </p>
              <Show when={existingUserForEmail()}>{(user) => (
                <div style="margin-top: 12px; padding: 10px 12px; background: rgba(13, 148, 136, 0.08); border-left: 4px solid rgba(13, 148, 136, 0.3); border-radius: 4px; color: #5eead4; font-size: 13px; display: flex; align-items: center; gap: 8px">
                  <span style="flex: 1">
                    {props.adminIds.has(user().id)
                      ? 'This email belongs to an account that already has access.'
                      : 'This email belongs to an existing account — grant it access directly.'}
                  </span>
                  <Show when={!props.adminIds.has(user().id)}>
                    <button
                      type="button"
                      class="action-btn docker-pull"
                      style="padding: 6px 14px; margin: 0; flex-shrink: 0"
                      disabled={grantingId() === user().id}
                      onClick={() => handleGrant(user())}
                    >{grantingId() === user().id ? 'Granting…' : 'Grant Access'}</button>
                  </Show>
                </div>
              )}</Show>
              <Show when={alreadyInvited()}>
                <div style="margin-top: 12px; padding: 10px 12px; background: rgba(245, 158, 11, 0.08); border-left: 4px solid rgba(245, 158, 11, 0.3); border-radius: 4px; color: #fbbf24; font-size: 13px">
                  An invitation for this email is already pending.
                </div>
              </Show>
              <div style="display: flex; gap: 8px; margin-top: 16px">
                <button
                  type="button"
                  class="action-btn"
                  style="flex: 1"
                  onClick={() => props.onClose()}
                >Cancel</button>
                <button
                  type="button"
                  class="action-btn docker-pull"
                  style="flex: 1"
                  onClick={handleInvite}
                  disabled={!canInvite()}
                >{inviting() ? 'Sending…' : 'Send Invitation'}</button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
