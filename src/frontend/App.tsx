import { createResource, createSignal, For, Show, createEffect, onCleanup } from 'solid-js'
import './css/App.css'
import { SERVER_CATEGORIES, ALL_CATEGORIZED_SERVER_IDS } from './serverCategories.ts'
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser, useAuth } from 'clerk-solidjs'
import { ModuleEditorContent } from './components/views/ModuleDefinitions/ModuleEditorContent.tsx';
import { ServerCard } from './components/views/ServerCard.tsx';
import { LogsModal } from './components/modals/LogsModal.tsx';
import { BackupsModal } from './components/modals/BackupsModal.tsx';
import { SnapshotsView } from './components/views/SnapshotsView.tsx';
import { DockerPullModal } from './components/modals/DockerPullModal.tsx';
import type { ServerRestartStatus, BackupInfo, ViewType } from './types.ts';
import {
  fetchServerCardData,
  fetchServerLogs,
  fetchServerBackups,
  fetchServerStatus,
  fetchAllServerStatuses,
  fetchServerVersions,
  fetchVolumeSnapshots,
  dockerPull,
  downloadBackupFile,
  downloadEntireBackup,
  deleteVolumeSnapshotApi,
  createVolumeSnapshotApi,
  updateServerVersionApi,
  restartServerApi,
  backupServerApi,
  getUsersApi,
  getUserSessionsApi,
  fetchLockedServersApi,
  lockServerApi,
  unlockServerApi,
} from './services.ts';
import { ToastContainer } from './components/modals/Toast.tsx';
import { addToast } from './stores/toastStore.ts';
import { Users } from "./components/views/Users.tsx";

function App() {
  const { getToken } = useAuth();

  // get server data
  const [servers, { mutate }] = createResource(fetchServerCardData)

  // get server status, total users, uptime, etc
  const [statuses, { refetch: refetchStatuses }] = createResource(
    servers,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerStatuses(serverList, token);
    }
  );

  // get server versions
  const [serverVersions, { refetch: refetchServerVersions }] = createResource(async () => {
    const token = await getToken();
    return fetchServerVersions(token);
  });


  // track setting snapshot
  const [snappingVolume, setSnappingVolume] = createSignal<boolean>(false);

  // track expanded card
  const [expandedId, setExpandedId] = createSignal<string | null>(null)

  // track docker pull modal
  const [dockerPullModalOpen, setDockerPullModalOpen] = createSignal<boolean>(false);

  // track which server's logs to show in modal
  const [logsModalServerId, setLogsModalServerId] = createSignal<string | null>(null);
  const [modalLogs, setModalLogs] = createSignal<string>('');
  const [logsLoading, setLogsLoading] = createSignal<boolean>(false);

  // track when updating server and restarting server ids are loading
  const [updatingServerId, setUpdatingServerId] = createSignal<string | null>(null);
  const [restartingServerId, setRestartingServerId] = createSignal<string | null>(null);

  // track server restart statuses (idle, pending, online)
  const [serverRestartStatuses, setServerRestartStatuses] = createSignal<Record<string, ServerRestartStatus>>({});

  // track server backup statuses
  const [backingUpServerId, setBackingUpServerId] = createSignal<string | null>(null);

  // track which server's backups to show in modal
  const [backupsModalServerId, setBackupsModalServerId] = createSignal<string | null>(null);
  const [backupsList, setBackupsList] = createSignal<BackupInfo[]>([]);
  const [backupsLoading, setBackupsLoading] = createSignal<boolean>(false);

  // track when an ssh operation is happening to stop other ssh operations from occuring
  const [sshOperationInProgress, setSshOperationInProgress] = createSignal<boolean>(false);

  // track locked servers (shared, stored server-side)
  const [lockedServers, setLockedServers] = createSignal<Set<string>>(new Set());
  createResource(async () => {
    const token = await getToken();
    const locks = await fetchLockedServersApi(token);
    setLockedServers(new Set(locks));
  });
  const toggleLock = async (serverId: string) => {
    const token = await getToken();
    const isLocked = lockedServers().has(serverId);
    setLockedServers(prev => {
      const next = new Set(prev);
      isLocked ? next.delete(serverId) : next.add(serverId);
      return next;
    });
    isLocked ? await unlockServerApi(serverId, token) : await lockServerApi(serverId, token);
  };

  // track loading volume snapshots
  const [volumeSnapshots, { refetch: refetchSnapshots }] = createResource(async () => {
    const token = await getToken();
    return fetchVolumeSnapshots(token);
  });

  // get all users
  const [clerkUsers] = createResource(async () => {
    const token = await getToken();
    return getUsersApi(token);
  });

  // Track active view
  const [activeView, setActiveView] = createSignal<ViewType>("servers");

  // Auto-refresh statuses every 60 seconds
  createEffect(() => {
    const interval = setInterval(() => {
      refetchStatuses();
    }, 60000);
    onCleanup(() => clearInterval(interval));
  });

  const { user: currentUser } = useUser();
  const isAdmin = () => currentUser()?.publicMetadata?.isAdmin === true;

  // toggle card
  const toggleCard = (id: string) => {
    setExpandedId(expandedId() === id ? null : id)
  }

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

  // close logs modal
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

  // close backups modal
  const closeBackupsModal = () => {
    setBackupsModalServerId(null);
    setBackupsList([]);
  };

  // handle backup file download
  const handleDownloadFile = async (serverId: string, folder: string, file: string) => {
    const token = await getToken();
    await downloadBackupFile(serverId, folder, file, token);
  };

  // handle entire backup download
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

  // delete snapshot of volume
  const deleteVolumeSnapshot = async (snapshotId: string) => {
    if (!confirm('Are you sure you want to delete this snapshot? This action cannot be undone.')) {
      return;
    }
    try {
      const token = await getToken();
      const result = await deleteVolumeSnapshotApi(snapshotId, token);
      if (result.success) {
        addToast('Snapshot deleted successfully!', "success");
        refetchSnapshots();
      } else {
        addToast(`Failed to delete snapshot: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Error deleting snapshot: ${error}`, "error");
    }
  };

  // create snapshot of volume
  const createVolumeSnapshot = async () => {
    setSnappingVolume(true);
    try {
      const token = await getToken();
      const result = await createVolumeSnapshotApi(token);
      if (result.success) {
        addToast(`Volume snapshot created successfully!`, "success");
      } else {
        addToast(`Failed to create snapshot: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Error creating snapshot: ${error}`, "error");
    } finally {
      setSnappingVolume(false);
    }
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
          refetchStatuses();
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

  // update server version
  const updateServerVersion = async (serverId: string, version: string) => {
    if (sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }

    setSshOperationInProgress(true);
    setUpdatingServerId(serverId);

    try {
      const token = await getToken();
      const result = await updateServerVersionApi(serverId, version, token);

      if (result.success) {
        addToast(`${serverId} Server updated successfully to version ${version}.`, "success");

        const currentServers = servers();
        if (currentServers) {
          const updatedServers = currentServers.map((server) =>
            server.id === serverId
              ? { ...server, serverVersion: version }
              : server
          );
          mutate(updatedServers);
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
      setSshOperationInProgress(false);
    }
  };

  // restart server (user-initiated)
  const restartServer = async (serverId: string) => {
    if (sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }

    setSshOperationInProgress(true);
    try {
      await restartServerInternal(serverId);
    } finally {
      setSshOperationInProgress(false);
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

  // fetch sessions for a user
  const handleFetchSessions = async (userId: string) => {
    const token = await getToken();
    return getUserSessionsApi(userId, token);
  };

  // docker pull handler
  const handleDockerPull = async (version: string) => {
    if (sshOperationInProgress()) {
      addToast('Please wait for the current operation to complete', "info");
      return;
    }

    setSshOperationInProgress(true);
    try {
      const token = await getToken();
      await dockerPull(version, token);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await refetchServerVersions();
    } finally {
      setSshOperationInProgress(false);
    }
  };

  return (
    <>
      <ToastContainer />
      <div class="sticky-header">
        <h1>Fastr Analytics Admin Dashboard</h1>
        <SignedIn>
          <Show when={isAdmin()}>
            <div class="button-container">
              <button
                type="button"
                data-selected={activeView() === "servers"}
                onClick={() => setActiveView("servers")}
              >
                Servers
              </button>
              <button
                type="button"
                data-selected={activeView() === "snapshots"}
                onClick={() => setActiveView("snapshots")}
              >
                Snapshots
              </button>
              <button
                type="button"
                data-selected={activeView() === "users"}
                onClick={() => setActiveView("users")}
              >
                Users
              </button>
              <button
                type="button"
                data-selected={activeView() === "moduleEditor"}
                onClick={() => setActiveView("moduleEditor")}
              >
                Module Definitions
              </button>
              <button
                type="button"
                onClick={() => setDockerPullModalOpen(true)}
              >
                Docker Pull
              </button>
            </div>
          </Show>
        </SignedIn>
      </div>

      {/* Authentication UI */}
      <div class="auth-container">
        <SignedOut>
          <div class ="auth-box">
            <div class="auth-box-header">
              <h2>Admin Website Login</h2>
            </div>
            <div class ="auth-box-content">
              <SignInButton mode="modal" >
                Sign In
              </SignInButton>
              <SignUpButton mode="modal">
                Sign Up
              </SignUpButton>
            </div>
          </div>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </div>

      <SignedIn>
        <Show
          when={isAdmin()}
          fallback={
            <div class="access-denied">
              <h2>Access Denied</h2>
              <p>You do not have permission to access this admin dashboard.</p>
              <p>Please contact an administrator if you believe this is an error.</p>
            </div>
          }
        >
          <Show when={activeView() === "servers"}>
            {servers.loading && <h2 class="loading-text">Loading...</h2>}
            {servers.error && <p>Error: {servers.error.message}</p>}
            {servers() && (
              <div class="servers-container">
                <For each={[...SERVER_CATEGORIES, { name: "Misc", servers: (servers() || []).filter(s => !ALL_CATEGORIZED_SERVER_IDS.has(s.id)).map(s => s.id) }]}>
                  {(category) => {
                    const categoryServers = () => servers()?.filter(s =>
                      category.servers.includes(s.id)
                    ) || [];

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
                                  status={statuses()?.[server.id] ?? null}
                                  restartStatus={serverRestartStatuses()[server.id] ?? 'idle'}
                                  versions={serverVersions() || []}
                                  updatingServerId={updatingServerId()}
                                  restartingServerId={restartingServerId()}
                                  backingUpServerId={backingUpServerId()}
                                  sshOperationInProgress={sshOperationInProgress()}
                                  onUpdate={updateServerVersion}
                                  onRestart={restartServer}
                                  onBackup={backupServer}
                                  onViewBackups={openBackupsModal}
                                  onViewLogs={openLogsModal}
                                  isLocked={lockedServers().has(server.id)}
                                  onToggleLock={toggleLock}
                                />
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    );
                  }}
                </For>
              </div>
            )}

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

            {/* Logs Modal */}
            {logsModalServerId() && (
              <LogsModal
                serverId={logsModalServerId()!}
                logs={modalLogs()}
                loading={logsLoading()}
                onClose={closeLogsModal}
              />
            )}
          </Show>

          <Show when={activeView() === "snapshots"}>
            <SnapshotsView
              snapshots={volumeSnapshots()}
              loading={volumeSnapshots.loading}
              error={volumeSnapshots.error}
              snappingVolume={snappingVolume()}
              onCreateSnapshot={createVolumeSnapshot}
              onDeleteSnapshot={deleteVolumeSnapshot}
            />
          </Show>

          <Show when={activeView() === "moduleEditor"}>
            <ModuleEditorContent/>
          </Show>

          <Show when={activeView() === "users"}>
            <Users
              users={clerkUsers()}
              loading={clerkUsers.loading}
              error={clerkUsers.error}
              onFetchSessions={handleFetchSessions}
              servers={servers()}
              onFetchInstanceStatus={async (serverId) => {
                const token = await getToken();
                return fetchServerStatus(serverId, token);
              }}
            />
          </Show>

        </Show>

        {/* Docker Pull Modal */}
        {dockerPullModalOpen() && (
          <DockerPullModal
            sshOperationInProgress={sshOperationInProgress()}
            onClose={() => setDockerPullModalOpen(false)}
            onPull={handleDockerPull}
          />
        )}
      </SignedIn>
    </>
  )
}

export default App
