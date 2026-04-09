import { createSignal, For, Show } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import { ServerCard } from './ServerCard.tsx';
import { ActiveInstancesBar } from './ActiveInstancesBar.tsx';
import { LogsModal } from '../../modals/LogsModal.tsx';
import { ServerActivityModal } from '../../modals/ServerActivityModal.tsx';
import { BackupsModal } from '../../modals/BackupsModal.tsx';
import { ServerMultiSelectModal } from '../../modals/ServerMultiSelectModal.tsx';
import { DeleteServerModal } from '../../modals/DeleteServerModal.tsx';
import { ConfigModal } from '../../modals/ConfigModal.tsx';
import { MoveVolumeModal } from '../../modals/MoveVolumeModal.tsx';
import type { Server, ServerRestartStatus, BackupInfo, HealthCheckResponse, ServerUserLogs } from '../../../types.ts';
import type { ServerCategory } from '../../../services.ts';
import {
  fetchServerLogs,
  fetchServerBackups,
  downloadBackupFile,
  downloadEntireBackup,
  updateServerVersionApi,
  restartServerApi,
  stopServerApi,
  backupServerApi,
  lockServerApi,
  unlockServerApi,
  bulkUpdateServerVersionApi,
  bulkRestartServerVersionApi,
  bulkStopServerApi,
  updateServerLanguageApi,
  updateServerCalendarApi,
  updateServerOpenAccessApi,
  updateServerLabelApi,
  assignServerCategoryApi,
  moveServerVolumeApi,
} from '../../../services.ts';
import { addToast } from '../../../stores/toastStore.ts';

interface ServersViewProps {
  servers: Accessor<Server[] | undefined>;
  serversLoading: boolean;
  serversError: any;
  mutate: (data: Server[] | undefined) => void;
  refetchServers: () => void;
  categories: Accessor<ServerCategory[] | undefined>;
  categoriesLoading: boolean;
  refetchDynamicCategories: () => void;
  statuses: Accessor<Record<string, HealthCheckResponse | null> | undefined>;
  statusesLoading: boolean;
  refetchStatuses: () => void;
  allServerUserLogs: Accessor<ServerUserLogs | undefined>;
  serverVersions: Accessor<string[] | undefined>;
  volumes: Accessor<string[] | undefined>;
  lockedServers: Accessor<Set<string>>;
  onToggleLock: (serverId: string) => void;
  sshOperationInProgress: Accessor<boolean>;
  setSshOperationInProgress: Setter<boolean>;
  multiSelectMode: Accessor<boolean>;
  multiSelectedServerIds: Accessor<string[] | null>;
  setMultiSelectedServerIds: Setter<string[] | null>;
  getToken: () => Promise<string | null>;
}

export function ServersView(props: ServersViewProps) {
  const { getToken } = props;

  // track expanded card
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  // track delete server modal
  const [deleteServerModalId, setDeleteServerModalId] = createSignal<string | null>(null);

  // track config modal
  const [configModalServerId, setConfigModalServerId] = createSignal<string | null>(null);

  // track move volume modal
  const [moveVolumeModalId, setMoveVolumeModalId] = createSignal<string | null>(null);

  // track which server's activity modal to show
  const [activityModalServerId, setActivityModalServerId] = createSignal<string | null>(null);

  // track which server's logs to show in modal
  const [logsModalServerId, setLogsModalServerId] = createSignal<string | null>(null);
  const [modalLogs, setModalLogs] = createSignal<string>('');
  const [logsLoading, setLogsLoading] = createSignal<boolean>(false);

  // track when updating server and restarting server ids are loading
  const [updatingServerId, setUpdatingServerId] = createSignal<string | null>(null);
  const [restartingServerId, setRestartingServerId] = createSignal<string | null>(null);
  const [stoppingServerId, setStoppingServerId] = createSignal<string | null>(null);

  // track server restart statuses (idle, pending, online)
  const [serverRestartStatuses, setServerRestartStatuses] = createSignal<Record<string, ServerRestartStatus>>({});

  // track server backup statuses
  const [backingUpServerId, setBackingUpServerId] = createSignal<string | null>(null);

  // track which server's backups to show in modal
  const [backupsModalServerId, setBackupsModalServerId] = createSignal<string | null>(null);
  const [backupsList, setBackupsList] = createSignal<BackupInfo[]>([]);
  const [backupsLoading, setBackupsLoading] = createSignal<boolean>(false);

  const toggleLock = async (serverId: string) => {
    const token = await getToken();
    const isLocked = props.lockedServers().has(serverId);
    props.onToggleLock(serverId);
    isLocked ? await unlockServerApi(serverId, token) : await lockServerApi(serverId, token);
  };

  // server list filters
  const [searchQuery, setSearchQuery] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal<'all' | 'online' | 'offline'>('all');
  const [versionFilter, setVersionFilter] = createSignal('all');
  const [lockedFilter, setLockedFilter] = createSignal<'all' | 'locked' | 'unlocked'>('all');

  const availableVersions = () => [...new Set((props.servers() || []).map(s => s.serverVersion))].sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const filteredServers = () => {
    const query = searchQuery().toLowerCase();
    return (props.servers() || []).filter(s => {
      if (query && !s.label.toLowerCase().includes(query) && !s.id.toLowerCase().includes(query)) return false;
      if (statusFilter() === 'online' && !props.statuses()?.[s.id]?.running) return false;
      if (statusFilter() === 'offline' && props.statuses()?.[s.id]?.running) return false;
      if (versionFilter() !== 'all' && s.serverVersion !== versionFilter()) return false;
      if (lockedFilter() === 'locked' && !props.lockedServers().has(s.id)) return false;
      if (lockedFilter() === 'unlocked' && props.lockedServers().has(s.id)) return false;
      return true;
    });
  };

  const activeInstances = () => (props.servers() || []).filter(s => {
    const log = props.statuses()?.[s.id]?.lastUserLog;
    return log && Date.now() - new Date(log.timestamp).getTime() < 30 * 60 * 1000;
  });

  // toggle card
  const toggleCard = (id: string) => {
    setExpandedId(expandedId() === id ? null : id);
  };

  // open logs modal
  const openLogsModal = async (serverId: string) => {
    setLogsModalServerId(serverId);
    setLogsLoading(true);
    const token = await getToken();
    const result = await fetchServerLogs(serverId, token);
    if (result?.success) {
      setModalLogs(result.logs);
    } else {
      setModalLogs(`Error: ${result?.error || 'Failed to fetch logs'}`);
    }
    setLogsLoading(false);
  };

  const closeLogsModal = () => {
    setLogsModalServerId(null);
    setModalLogs('');
  };

  // open backups modal
  const openBackupsModal = async (serverId: string) => {
    setBackupsModalServerId(serverId);
    setBackupsLoading(true);
    const token = await getToken();
    const backups = await fetchServerBackups(serverId, token);
    setBackupsList(backups);
    setBackupsLoading(false);
  };

  const closeBackupsModal = () => {
    setBackupsModalServerId(null);
    setBackupsList([]);
  };

  const handleDownloadFile = async (serverId: string, folder: string, file: string) => {
    const token = await getToken();
    await downloadBackupFile(serverId, folder, file, token);
  };

  const handleDownloadAll = async (serverId: string, folder: string) => {
    const token = await getToken();
    await downloadEntireBackup(serverId, folder, token);
  };

  // poll server logs until startup message is found
  const pollServerLogsForStartup = async (serverId: string) => {
    const maxAttempts = 400;
    let attempts = 0;

    const checkLogs = async (): Promise<boolean> => {
      attempts++;
      try {
        const token = await getToken();
        const result = await fetchServerLogs(serverId, token);
        if (result?.success && result.logs.includes('Listening on http://0.0.0.0:8000/')) {
          return true;
        }
        if (attempts >= maxAttempts) {
          console.error(`Server ${serverId} did not start after ${maxAttempts} attempts`);
          return false;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
        return await checkLogs();
      } catch (error) {
        console.error(`Error checking logs for ${serverId}:`, error);
        if (attempts >= maxAttempts) return false;
        await new Promise(resolve => setTimeout(resolve, 5000));
        return await checkLogs();
      }
    };

    return await checkLogs();
  };

  // Internal restart function (assumes SSH lock is already held)
  const restartServerInternal = async (serverId: string) => {
    setRestartingServerId(serverId);
    setServerRestartStatuses(prev => ({ ...prev, [serverId]: 'pending' }));
    try {
      const token = await getToken();
      const result = await restartServerApi(serverId, token);
      if (result.success) {
        const isOnline = await pollServerLogsForStartup(serverId);
        if (isOnline) {
          setServerRestartStatuses(prev => ({ ...prev, [serverId]: 'online' }));
          addToast(`Server ${serverId} restarted successfully and is now online.`, "success");
          props.refetchStatuses();
        } else {
          setServerRestartStatuses(prev => ({ ...prev, [serverId]: 'idle' }));
          addToast(`Server ${serverId} restart command sent, but failed to detect online status.`, "error");
        }
      } else {
        setServerRestartStatuses(prev => ({ ...prev, [serverId]: 'idle' }));
        addToast(`Failed to restart server ${serverId}: ${result.error}`, "error");
      }
    } catch (error) {
      setServerRestartStatuses(prev => ({ ...prev, [serverId]: 'idle' }));
      addToast(`Error restarting server ${serverId}: ${error}`, "error");
    } finally {
      setRestartingServerId(null);
    }
  };

  const bulkRestartServerInternal = async (serverIds: string[]) => {
    serverIds.forEach(id => {
      setServerRestartStatuses(prev => ({ ...prev, [id]: 'pending' }));
    });
    try {
      const token = await getToken();
      const result = await bulkRestartServerVersionApi(serverIds, token);
      if (result.success) {
        const results = await Promise.all(serverIds.map(id => pollServerLogsForStartup(id)));
        serverIds.forEach((id, i) => {
          if (results[i]) {
            setServerRestartStatuses(prev => ({ ...prev, [id]: 'online' }));
            addToast(`Server ${id} restarted successfully and is now online.`, "success");
          } else {
            setServerRestartStatuses(prev => ({ ...prev, [id]: 'idle' }));
            addToast(`Server ${id} restart command sent, but failed to detect online status.`, "error");
          }
        });
        props.refetchStatuses();
      } else {
        serverIds.forEach(id => {
          setServerRestartStatuses(prev => ({ ...prev, [id]: 'idle' }));
        });
        addToast(`Failed to bulk restart servers: ${result.error}`, "error");
      }
    } catch (error) {
      serverIds.forEach(id => {
        setServerRestartStatuses(prev => ({ ...prev, [id]: 'idle' }));
      });
      addToast(`Error restarting servers: ${error}`, "error");
    }
  };

  // update server version
  const updateServerVersion = async (serverId: string, version: string) => {
    if (props.sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }
    props.setSshOperationInProgress(true);
    setUpdatingServerId(serverId);
    try {
      const token = await getToken();
      const result = await updateServerVersionApi(serverId, version, token);
      if (result.success) {
        addToast(`${serverId} Server updated successfully to version ${version}.`, "success");
        const currentServers = props.servers();
        if (currentServers) {
          props.mutate(currentServers.map(server =>
            server.id === serverId ? { ...server, serverVersion: version } : server
          ));
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        setUpdatingServerId(null);
        await restartServerInternal(serverId);
      } else {
        addToast(`Error: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Failed to update server: ${error}`, "error");
    } finally {
      setUpdatingServerId(null);
      props.setSshOperationInProgress(false);
    }
  };

  // bulk update server versions
  const bulkUpdateServerVersion = async (serverIds: string[], version: string) => {
    if (props.sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }
    props.setSshOperationInProgress(true);
    try {
      const token = await getToken();
      const result = await bulkUpdateServerVersionApi(serverIds, version, token);
      if (result.success) {
        addToast(`Servers updated successfully to version ${version}`, "success");
        const currentServers = props.servers();
        if (currentServers) {
          props.mutate(currentServers.map(server =>
            serverIds.includes(server.id) ? { ...server, serverVersion: version } : server
          ));
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        await bulkRestartServerInternal(serverIds);
      } else {
        addToast(`Error: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Failed to update server: ${error}`, "error");
    } finally {
      props.setSshOperationInProgress(false);
    }
  };

  // bulk restart servers (user-initiated)
  const bulkRestartServer = async (serverIds: string[]) => {
    if (props.sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }
    props.setSshOperationInProgress(true);
    try {
      await bulkRestartServerInternal(serverIds);
    } finally {
      props.setSshOperationInProgress(false);
    }
  };

  // bulk stop servers
  const bulkStopServer = async (serverIds: string[]) => {
    if (props.sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }
    props.setSshOperationInProgress(true);
    try {
      const token = await getToken();
      const result = await bulkStopServerApi(serverIds, token);
      if (result.success) {
        addToast(`${serverIds.length} servers stopped successfully.`, "success");
        props.refetchStatuses();
      } else {
        addToast(`Failed to stop servers: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Error stopping servers: ${error}`, "error");
    } finally {
      props.setSshOperationInProgress(false);
    }
  };

  // restart server (user-initiated)
  const restartServer = async (serverId: string) => {
    if (props.sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }
    props.setSshOperationInProgress(true);
    try {
      await restartServerInternal(serverId);
    } finally {
      props.setSshOperationInProgress(false);
    }
  };

  // stop server
  const stopServer = async (serverId: string) => {
    if (props.sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }
    props.setSshOperationInProgress(true);
    setStoppingServerId(serverId);
    try {
      const token = await getToken();
      const result = await stopServerApi(serverId, token);
      if (result.success) {
        addToast(`Server ${serverId} stopped successfully.`, "success");
        props.refetchStatuses();
      } else {
        addToast(`Failed to stop server ${serverId}: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Error stopping server ${serverId}: ${error}`, "error");
    } finally {
      setStoppingServerId(null);
      props.setSshOperationInProgress(false);
    }
  };

  // backup server
  const backupServer = async (serverId: string) => {
    setBackingUpServerId(serverId);
    try {
      const token = await getToken();
      const result = await backupServerApi(serverId, token);
      if (result.success) {
        addToast(`Backup created successfully for ${serverId}`, "success");
      } else {
        addToast(`Failed to backup ${serverId}: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Error backing up server ${serverId}: ${error}`, "error");
    } finally {
      setBackingUpServerId(null);
    }
  };

  const handleSaveConfig = async (
    serverId: string,
    changes: { french?: boolean; ethiopian?: boolean; openAccess?: boolean; label?: string; category?: string },
  ) => {
    if (props.sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', 'info');
      return;
    }
    props.setSshOperationInProgress(true);
    try {
      const token = await getToken();
      if (changes.french !== undefined) {
        const r = await updateServerLanguageApi(serverId, changes.french, token);
        if (!r.success) { addToast(`Error: ${r.error}`, 'error'); return; }
      }
      if (changes.ethiopian !== undefined) {
        const r = await updateServerCalendarApi(serverId, changes.ethiopian, token);
        if (!r.success) { addToast(`Error: ${r.error}`, 'error'); return; }
      }
      if (changes.openAccess !== undefined) {
        const r = await updateServerOpenAccessApi(serverId, changes.openAccess, token);
        if (!r.success) { addToast(`Error: ${r.error}`, 'error'); return; }
      }
      if (changes.label !== undefined) {
        const r = await updateServerLabelApi(serverId, changes.label, token);
        if (!r.success) { addToast(`Error: ${r.error}`, 'error'); return; }
      }
      if (changes.category !== undefined) {
        const r = await assignServerCategoryApi(serverId, changes.category, token);
        if (!r.success) { addToast(`Error: ${r.error}`, 'error'); return; }
        props.refetchDynamicCategories();
      }
      props.mutate(props.servers()?.map(s => s.id === serverId ? { ...s, ...changes } : s));
      addToast('Configuration saved', 'success');
      setConfigModalServerId(null);
    } catch (error) {
      addToast(`Error: ${error}`, 'error');
    } finally {
      props.setSshOperationInProgress(false);
    }
  };

  const handleMoveVolume = async (serverId: string, newVolume: string) => {
    props.setSshOperationInProgress(true);
    try {
      const token = await getToken();
      const result = await moveServerVolumeApi(serverId, newVolume, token);
      if (!result.success) { addToast(`Move failed: ${result.error}`, 'error'); return; }
      await props.refetchServers();
      addToast(`${serverId} moved to /mnt/${newVolume}`, 'success');
      setMoveVolumeModalId(null);
    } catch (error) {
      addToast(`Move failed: ${error}`, 'error');
    } finally {
      props.setSshOperationInProgress(false);
    }
  };

  return (
    <>
      {(props.serversLoading || props.categoriesLoading) && <h2 class="loading-text">Loading...</h2>}
      {props.serversError && <p>Error: {props.serversError.message}</p>}
      {props.servers() && props.categories() && (
        <div class="servers-container">
          <ActiveInstancesBar instances={activeInstances()} statuses={props.statuses()} loading={props.statusesLoading} />
          <div class="server-filter-bar">
            <input
              class="server-filter-input"
              type="text"
              placeholder="Search by name or ID..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
            <select class="server-filter-select" value={statusFilter()} onChange={(e) => setStatusFilter(e.currentTarget.value as 'all' | 'online' | 'offline')}>
              <option value="all">All Statuses</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
            </select>
            <select class="server-filter-select" value={versionFilter()} onChange={(e) => setVersionFilter(e.currentTarget.value)}>
              <option value="all">All Versions</option>
              <For each={availableVersions()}>{(v) => <option value={v}>{v}</option>}</For>
            </select>
            <select class="server-filter-select" value={lockedFilter()} onChange={(e) => setLockedFilter(e.currentTarget.value as 'all' | 'locked' | 'unlocked')}>
              <option value="all">All Lock States</option>
              <option value="locked">Locked</option>
              <option value="unlocked">Unlocked</option>
            </select>
          </div>
          <For each={(() => {
            const cats = props.categories() || [];
            const allIds = new Set(cats.flatMap(cat => cat.servers));
            return [...cats, { name: "Misc", servers: (props.servers() || []).filter(s => !allIds.has(s.id)).map(s => s.id) }];
          })()}>
            {(category) => {
              const categoryServers = () => filteredServers().filter(s =>
                category.servers.includes(s.id)
              );

              return (
                <Show when={categoryServers().length > 0}>
                  <div class="category-section">
                    <h2 class="category-header">{category.name}</h2>
                    <div class="servers-grid">
                      <For each={categoryServers()}>
                        {(server) => (
                          <ServerCard
                            server={server}
                            isExpanded={expandedId() === server.id}
                            onToggle={() => toggleCard(server.id)}
                            status={props.statuses()?.[server.id] ?? null}
                            isLoading={props.statusesLoading && props.statuses() === undefined}
                            restartStatus={serverRestartStatuses()[server.id] ?? 'idle'}
                            versions={props.serverVersions() || []}
                            updatingServerId={updatingServerId()}
                            restartingServerId={restartingServerId()}
                            backingUpServerId={backingUpServerId()}
                            sshOperationInProgress={props.sshOperationInProgress()}
                            onUpdate={updateServerVersion}
                            onRestart={restartServer}
                            onStop={stopServer}
                            stoppingServerId={stoppingServerId()}
                            onBackup={backupServer}
                            onViewBackups={openBackupsModal}
                            onViewLogs={openLogsModal}
                            isLocked={props.lockedServers().has(server.id)}
                            onToggleLock={toggleLock}
                            multiSelectMode={props.multiSelectMode()}
                            isSelected={props.multiSelectedServerIds()!.includes(server.id)}
                            onToggleSelect={(id) => props.setMultiSelectedServerIds(prev =>
                              prev!.includes(id) ? prev!.filter(x => x !== id) : [...prev!, id]
                            )}
                            onDelete={(id) => setDeleteServerModalId(id)}
                            onConfig={(id) => setConfigModalServerId(id)}
                            onMoveVolume={(id) => setMoveVolumeModalId(id)}
                            onActivityDotClick={(id) => setActivityModalServerId(id)}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              );
            }}
          </For>

          {/* Backups Modal */}
          {backupsModalServerId() && (
            <BackupsModal
              serverId={backupsModalServerId()!}
              backups={backupsList()}
              loading={backupsLoading()}
              onClose={closeBackupsModal}
              onDownloadFile={handleDownloadFile}
              onDownloadAll={handleDownloadAll}
            />
          )}

          {/* Activity Modal */}
          {activityModalServerId() && (
            <ServerActivityModal
              serverId={activityModalServerId()!}
              serverLabel={props.servers()?.find(s => s.id === activityModalServerId())?.label ?? activityModalServerId()!}
              userLogs={props.allServerUserLogs()?.[activityModalServerId()!] ?? []}
              onClose={() => setActivityModalServerId(null)}
            />
          )}

          {/* Logs Modal */}
          {logsModalServerId() && (
            <LogsModal
              serverId={logsModalServerId()!}
              logs={modalLogs()}
              loading={logsLoading()}
              onClose={closeLogsModal}
            />
          )}

          {/* Bulk select modal */}
          {(props.multiSelectedServerIds()?.length ?? 0) > 0 && (
            <ServerMultiSelectModal
              serverIds={props.multiSelectedServerIds()!}
              versions={props.serverVersions() || []}
              sshOperationInProgress={props.sshOperationInProgress()}
              onUpdate={bulkUpdateServerVersion}
              onRestart={bulkRestartServer}
              onStop={bulkStopServer}
            />
          )}
        </div>
      )}

      {/* Delete Server Modal */}
      {deleteServerModalId() && (
        <DeleteServerModal
          serverId={deleteServerModalId()!}
          onClose={() => setDeleteServerModalId(null)}
          onDeleted={() => { setDeleteServerModalId(null); props.refetchServers(); }}
          getToken={getToken}
        />
      )}

      {/* Config Modal */}
      {configModalServerId() && (
        <ConfigModal
          server={props.servers()!.find(s => s.id === configModalServerId())!}
          sshOperationInProgress={props.sshOperationInProgress()}
          categories={props.categories() || []}
          currentCategory={(props.categories() || []).find(c => c.servers.includes(configModalServerId()!))?.name ?? ''}
          onClose={() => setConfigModalServerId(null)}
          onSave={handleSaveConfig}
        />
      )}

      {/* Move Volume Modal */}
      {moveVolumeModalId() && (
        <MoveVolumeModal
          server={props.servers()!.find(s => s.id === moveVolumeModalId())!}
          volumes={props.volumes() ?? []}
          inProgress={props.sshOperationInProgress()}
          onClose={() => setMoveVolumeModalId(null)}
          onConfirm={handleMoveVolume}
        />
      )}
    </>
  );
}
