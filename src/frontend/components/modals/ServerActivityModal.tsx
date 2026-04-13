import { For, Show } from 'solid-js';
import { timeAgo } from '../../utils.ts';
import type { UserLog } from '../../types.ts';

interface ServerActivityModalProps {
  serverId: string;
  serverLabel: string;
  userLogs: UserLog[];
  onClose: () => void;
}

export function ServerActivityModal(props: ServerActivityModalProps) {
  const recentUsers = () => {
    const map = new Map<string, string>(); // email -> latest timestamp
    for (const log of props.userLogs) {
      if (log.endpoint === 'getCurrentUser') {
        const existing = map.get(log.user_email);
        if (!existing || log.timestamp > existing) {
          map.set(log.user_email, log.timestamp);
        }
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, 10);
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 420px">
        <div class="modal-header">
          <h2>Recent Activity — {props.serverLabel}</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <Show when={recentUsers().length === 0}>
            <p style="color: #888; text-align: center; padding: 16px 0">No activity recorded.</p>
          </Show>
          <Show when={recentUsers().length > 0}>
            <div style="display: flex; flex-direction: column; gap: 8px">
              <For each={recentUsers()}>{([email, timestamp], i) => (
                <div style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: #f9f9f9; border-radius: 6px; border: 1px solid #e0e0e0">
                  <span style="font-size: 13px; color: #888; min-width: 18px; text-align: right">{i() + 1}.</span>
                  <span style="flex: 1; font-size: 14px; color: #2c3e50; font-weight: 500; word-break: break-all">{email}</span>
                  <span style="font-size: 12px; color: #666; white-space: nowrap">{timeAgo(timestamp)}</span>
                </div>
              )}</For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
