import { createSignal, For } from 'solid-js';
import type { BackupInfo } from '../../types.ts';
import { formatBytes } from '../../utils.ts';

interface BackupsModalProps {
  serverId: string;
  backups: BackupInfo[];
  loading: boolean;
  onClose: () => void;
  onDownloadFile: (serverId: string, folder: string, file: string) => void;
  onDownloadAll: (serverId: string, folder: string) => void;
}

export function BackupsModal(props: BackupsModalProps) {
  const [expandedBackup, setExpandedBackup] = createSignal<string | null>(null);

  const toggleBackupExpand = (folder: string) => {
    setExpandedBackup(expandedBackup() === folder ? null : folder);
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content backups-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Backups: {props.serverId}</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          {props.loading ? (
            <div class="logs-loading">
              <div class="spinner"></div>
              <p>Loading backups...</p>
            </div>
          ) : props.backups.length === 0 ? (
            <div class="no-backups">
              <p>No backups found for this server.</p>
            </div>
          ) : (
            <div class="backups-list">
              <For each={props.backups}>
                {(backup) => (
                  <div class="backup-item">
                    <div class="backup-header" onClick={() => toggleBackupExpand(backup.folder)}>
                      <div class="backup-info">
                        <span class="backup-timestamp">{backup.timestamp}</span>
                        <span class="backup-meta">
                          {backup.backed_up_projects} projects • {formatBytes(backup.size)} • {backup.file_count} files
                        </span>
                      </div>
                      <span class="backup-expand-icon">{expandedBackup() === backup.folder ? '▼' : '▶'}</span>
                    </div>

                    {expandedBackup() === backup.folder && (
                      <div class="backup-files">
                        <div class="download-all-section">
                          <button
                            type="button"
                            class="download-all-btn"
                            onClick={() => props.onDownloadAll(props.serverId, backup.folder)}
                          >
                            📥 Download Entire Backup ({formatBytes(backup.size)})
                          </button>
                        </div>

                        <div class="backup-section-header">
                          <span>Main Files</span>
                        </div>
                        <For each={backup.files.filter(f => f.type === 'main' || f.type === 'metadata' || f.type === 'log')}>
                          {(file) => (
                            <div class="backup-file" onClick={() => props.onDownloadFile(props.serverId, backup.folder, file.name)}>
                              <span class="file-icon">
                                {file.type === 'main' ? '📦' : file.type === 'metadata' ? '📄' : '📋'}
                              </span>
                              <span class="file-name">{file.name}</span>
                              <span class="file-size">{formatBytes(file.size)}</span>
                              <span class="file-type">
                                {file.type === 'main' ? 'Main Database' : file.type === 'metadata' ? 'Metadata' : 'Log File'}
                              </span>
                            </div>
                          )}
                        </For>

                        <div class="backup-section-header">
                          <span>Project Backups ({backup.files.filter(f => f.type === 'project').length})</span>
                        </div>
                        <For each={backup.files.filter(f => f.type === 'project')}>
                          {(file) => (
                            <div class="backup-file" onClick={() => props.onDownloadFile(props.serverId, backup.folder, file.name)}>
                              <span class="file-icon">🗄️</span>
                              <span class="file-name">{file.name}</span>
                              <span class="file-size">{formatBytes(file.size)}</span>
                              <span class="file-type">Project Database</span>
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </div>
                )}
              </For>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
