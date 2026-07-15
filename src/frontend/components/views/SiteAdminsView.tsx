import { For, Show, createMemo, createSignal } from 'solid-js';
import type { ClerkInvitation, ClerkUser, SiteAdminsData } from '../../types.ts';
import { formatDate } from '../../utils.ts';
import { revokeAdminApi, revokeAdminInviteApi } from '../../services.ts';
import { addToast } from '../../stores/toastStore.ts';
import { AddAdminModal } from '../modals/AddAdminModal.tsx';

interface SiteAdminsViewProps {
  data: SiteAdminsData | null | undefined;
  loading: boolean;
  onRefetch: () => void;
  allUsers: ClerkUser[] | undefined;
  isSuperUser: () => boolean;
  superUserEmail: string;
  getToken: () => Promise<string | null>;
}

export function primaryEmail(user: ClerkUser): string {
  const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
  return primary?.email_address ?? '—';
}

export function displayName(user: ClerkUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || user.username || '—';
}

export function SiteAdminsView(props: SiteAdminsViewProps) {
  const [addModalOpen, setAddModalOpen] = createSignal(false);
  const [revokingUserId, setRevokingUserId] = createSignal<string | null>(null);
  const [revokingInviteId, setRevokingInviteId] = createSignal<string | null>(null);

  const isOwner = (user: ClerkUser) => primaryEmail(user).toLowerCase() === props.superUserEmail;

  // Super user first, then alphabetical by email
  const admins = createMemo(() =>
    [...(props.data?.admins ?? [])].sort((a, b) => {
      if (isOwner(a) !== isOwner(b)) return isOwner(a) ? -1 : 1;
      return primaryEmail(a).localeCompare(primaryEmail(b));
    })
  );

  const adminIds = createMemo(() => new Set(admins().map(u => u.id)));
  const invitations = createMemo(() => props.data?.invitations ?? []);

  const handleRevoke = async (user: ClerkUser) => {
    const email = primaryEmail(user);
    if (!confirm(`Remove admin website access for ${email}? Their platform account is not affected.`)) return;
    setRevokingUserId(user.id);
    const token = await props.getToken();
    const result = await revokeAdminApi(user.id, token);
    setRevokingUserId(null);
    if (result.success) {
      addToast(`Access removed for ${email}`, 'success');
      props.onRefetch();
    } else {
      addToast(result.error || 'Failed to remove access', 'error');
    }
  };

  const handleRevokeInvite = async (invitation: ClerkInvitation) => {
    if (!confirm(`Revoke the invitation for ${invitation.email_address}?`)) return;
    setRevokingInviteId(invitation.id);
    const token = await props.getToken();
    const result = await revokeAdminInviteApi(invitation.id, token);
    setRevokingInviteId(null);
    if (result.success) {
      addToast(`Invitation for ${invitation.email_address} revoked`, 'success');
      props.onRefetch();
    } else {
      addToast(result.error || 'Failed to revoke invitation', 'error');
    }
  };

  return (
    <div class="volume-usage-container">
      <div class="volume-usage-content">
        <div class="volume-usage-header">
          <h2 class="volume-usage-title">Site Admins</h2>
          <div style="display: flex; gap: 12px">
            <button class="system-btn" onClick={() => props.onRefetch()}>Refresh</button>
            <Show when={props.isSuperUser()}>
              <button class="system-btn snapshot" onClick={() => setAddModalOpen(true)}>Add Person</button>
            </Show>
          </div>
        </div>

        <Show when={props.loading}>
          <div class="volume-usage-loading">
            <div class="spinner"></div>
            <p>Loading site admins...</p>
          </div>
        </Show>

        <Show when={!props.loading && props.data === null}>
          <div class="volume-usage-error">
            <p>Failed to load the admin list. Try refreshing.</p>
          </div>
        </Show>

        <Show when={!props.loading && props.data}>
          <div class="access-log-toolbar">
            <span class="access-log-stats">
              {admins().length} {admins().length === 1 ? 'person has' : 'people have'} access
              {invitations().length > 0 ? ` · ${invitations().length} pending invitation${invitations().length === 1 ? '' : 's'}` : ''}
            </span>
          </div>

          <table class="access-log-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Joined</th>
                <th>Last Sign-in</th>
                <Show when={props.isSuperUser()}>
                  <th style="width: 1%"></th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={admins()}>
                {(user) => (
                  <tr>
                    <td class="access-log-email">
                      {displayName(user)}
                      <Show when={isOwner(user)}>
                        <span class="badge" style="margin-left: 8px">Owner</span>
                      </Show>
                    </td>
                    <td>{primaryEmail(user)}</td>
                    <td class="access-log-time">{formatDate(new Date(user.created_at).toISOString())}</td>
                    <td class="access-log-time">
                      {user.last_sign_in_at ? formatDate(new Date(user.last_sign_in_at).toISOString()) : 'Never'}
                    </td>
                    <Show when={props.isSuperUser()}>
                      <td style="text-align: right">
                        <Show when={!isOwner(user)}>
                          <button
                            type="button"
                            class="action-btn danger"
                            style="padding: 6px 14px; margin: 0"
                            disabled={revokingUserId() === user.id}
                            onClick={() => handleRevoke(user)}
                          >{revokingUserId() === user.id ? 'Removing…' : 'Remove'}</button>
                        </Show>
                      </td>
                    </Show>
                  </tr>
                )}
              </For>
            </tbody>
          </table>

          <Show when={invitations().length > 0}>
            <h3 style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin: 28px 0 12px">
              Pending Invitations
            </h3>
            <table class="access-log-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Invited</th>
                  <Show when={props.isSuperUser()}>
                    <th style="width: 1%"></th>
                  </Show>
                </tr>
              </thead>
              <tbody>
                <For each={invitations()}>
                  {(invitation) => (
                    <tr>
                      <td class="access-log-email">{invitation.email_address}</td>
                      <td class="access-log-time">{formatDate(new Date(invitation.created_at).toISOString())}</td>
                      <Show when={props.isSuperUser()}>
                        <td style="text-align: right">
                          <button
                            type="button"
                            class="action-btn danger"
                            style="padding: 6px 14px; margin: 0"
                            disabled={revokingInviteId() === invitation.id}
                            onClick={() => handleRevokeInvite(invitation)}
                          >{revokingInviteId() === invitation.id ? 'Revoking…' : 'Revoke'}</button>
                        </td>
                      </Show>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>

        <Show when={addModalOpen()}>
          <AddAdminModal
            onClose={() => setAddModalOpen(false)}
            onChanged={() => props.onRefetch()}
            getToken={props.getToken}
            allUsers={props.allUsers}
            adminIds={adminIds()}
            pendingInviteEmails={new Set(invitations().map(i => i.email_address.toLowerCase()))}
          />
        </Show>
      </div>
    </div>
  );
}
