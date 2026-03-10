import { createSignal, For, Show } from 'solid-js';
import type { Server, HealthCheckResponse, ServerRestartStatus } from '../../types.ts';
import { filterVersionsForServer, formatUptime, timeAgo } from '../../utils.ts';

interface ServerCardProps {
  server: Server;
  isExpanded: boolean;
  onToggle: () => void;
  status: HealthCheckResponse | null;
  restartStatus: ServerRestartStatus;
  versions: string[];
  updatingServerId: string | null;
  restartingServerId: string | null;
  backingUpServerId: string | null;
  sshOperationInProgress: boolean;
  onUpdate: (serverId: string, version: string) => void;
  onRestart: (serverId: string) => void;
  onBackup: (serverId: string) => void;
  onViewBackups: (serverId: string) => void;
  onViewLogs: (serverId: string) => void;
  isLocked: boolean;
  onToggleLock: (serverId: string) => void;
}

export function ServerCard(props: ServerCardProps) {
  const [selectedVersion, setSelectedVersion] = createSignal(props.server.serverVersion);

  return (
    <div class={`server-card ${props.isExpanded ? 'expanded' : ''}`} onClick={() => props.onToggle()}>
      {/*Collapsed View*/}
      <div class="card-header">
        <div class="card-label">
          <a href={`https://${props.server.id}.fastr-analytics.org`} target="_blank" onClick={(e) => e.stopPropagation()}>
            <h2>{props.server.label}</h2>
          </a>
          {(() => {
            const log = props.status?.lastUserLog;
            const isActive = log
              ? Date.now() - new Date(log.timestamp).getTime() < 30 * 60 * 1000
              : false;
            const title = log
              ? `Last activity: ${log.userEmail} — ${timeAgo(log.timestamp)}`
              : 'No activity recorded';
            return <div class={`activity-dot ${isActive ? 'active' : 'inactive'}`} title={title} />;
          })()}
          <span
            class="lock-icon-wrapper"
            title={props.isLocked ? 'Locked — click to unlock' : 'Unlocked — click to lock'}
            onClick={(e) => { e.stopPropagation(); props.onToggleLock(props.server.id); }}
          >
            <svg
              class={`lock-icon ${props.isLocked ? 'locked' : 'unlocked'}`}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              aria-label={props.isLocked ? 'Locked' : 'Unlocked'}
            >
              <path d={props.isLocked
                ? "M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2z"
                : "M18 8h-1V6A5 5 0 0 0 7 6h2a3 3 0 0 1 6 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"
              } />
            </svg>
          </span>
        </div>
        <span class="expand-icon">{props.isExpanded ? '▼' : '▶'}</span>
      </div>
      <p><strong>ID:</strong> {props.server.id}</p>
      <p><strong>Server Version:</strong> {props.server.serverVersion}</p>
      {props.server.adminVersion && <p><strong>Admin Version:</strong> {props.server.adminVersion}</p>}
      <p>
        <strong>Status:</strong>{' '}
        {(() => {
          if (props.restartStatus === 'pending') {
            return <span class="status-pending">Pending</span>;
          }
          return (
            <span class={props.status?.running ? "status-online" : "status-offline"}>
              {props.status?.running ? "Online" : "Offline"}
            </span>
          );
        })()}
      </p>
      <div class="flags">
        {props.server.french && <span class="badge">French</span>}
        {props.server.ethiopian && <span class="badge calendar">Ethiopian</span>}
        {props.server.openAccess && <span class="badge access">Open Access</span>}
      </div>

      {/* Expanded view */}
      <Show when={props.isExpanded}>
        <div class="expanded-content" onClick={(e) => e.stopPropagation()}>
          <hr/>

          {/* Version Control */}
          <div class="control-section">
            <h3>Version Control</h3>
            <label>
              <strong>Server Version:</strong>
              <select class="version-select"
                value={selectedVersion()}
                onChange={(e) => setSelectedVersion(e.currentTarget.value)}
              >
                <For each={filterVersionsForServer(props.versions || [], props.server.serverVersion)}>{(version) =>
                  <option value={version} selected={props.server.serverVersion === version}>{version}</option>
                }</For>
              </select>
            </label>
            <button
              class="update-btn"
              onClick={() => props.onUpdate(props.server.id, selectedVersion())}
              disabled={props.isLocked || props.updatingServerId === props.server.id || props.sshOperationInProgress}
            >
              {props.isLocked ? 'Server Locked' : props.updatingServerId === props.server.id ? (
                <>
                  <span class="button-spinner"></span>
                  Updating...
                </>
              ) : props.sshOperationInProgress ? (
                'SSH Operation in Progress...'
              ) : (
                'Update Version'
              )}
            </button>
          </div>

          {/* Analytics */}
          <div class="analytics-section">
            <h3>Analytics</h3>
            <div class="stats-grid">
              <div class="stat-item">
                <span class="stat-label">Total Users:</span>
                <span class="stat-value">{props.status?.totalUsers ?? '0'}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Uptime:</span>
                <span class="stat-value">
                  {props.status?.uptimeMs
                    ? formatUptime(props.status.uptimeMs)
                    : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Admin Users */}
          <div class="admin-users-section">
            <h3>Admin Users ({props.status?.adminUsers?.length ?? 0})</h3>
            <div class="admin-users-grid">
              <For each={props.status?.adminUsers ?? []}>
                {(email) => (
                  <div class="admin-user-card">
                    <span class="user-icon">👤</span>
                    <span class="user-email">{email}</span>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* Actions */}
          <div class="actions-section">
            <h3>Actions</h3>
            <button
              class="action-btn restart"
              onClick={() => props.onRestart(props.server.id)}
              disabled={props.isLocked || props.restartingServerId === props.server.id || props.sshOperationInProgress}
            >
              {props.isLocked ? 'Server Locked' : props.restartingServerId === props.server.id ? (
                <>
                  <span class="button-spinner"></span>
                  Restarting...
                </>
              ) : props.sshOperationInProgress ? (
                'SSH Operation in Progress...'
              ) : (
                'Restart Server'
              )}
            </button>
            <button
              class="action-btn backup"
              onClick={() => props.onBackup(props.server.id)}
              disabled={props.backingUpServerId === props.server.id}
            >
              {props.backingUpServerId === props.server.id ? (
                <>
                  <span class="button-spinner"></span>
                  Backing Up...
                </>
              ): (
                'Back Up Server'
              )}
            </button>
            <button class="action-btn" onClick={() => props.onViewBackups(props.server.id)}>View Backups</button>
            <button class="action-btn" onClick={() => props.onViewLogs(props.server.id)}>View Logs</button>
            <button class="action-btn">Configuration</button>
          </div>
        </div>
      </Show>
    </div>
  );
}
