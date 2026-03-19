import { createResource, createSignal, For, Show, createEffect, onCleanup } from 'solid-js'
import './css/App.css'
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser, useAuth } from 'clerk-solidjs'
import { ModuleEditorContent } from './components/views/ModuleDefinitions/ModuleEditorContent.tsx';
import { ServerCard } from './components/views/ServerCard.tsx';
import { ActiveInstancesBar } from './components/views/ActiveInstancesBar.tsx';
import { LogsModal } from './components/modals/LogsModal.tsx';
import { BackupsModal } from './components/modals/BackupsModal.tsx';
import { SnapshotsView } from './components/views/SnapshotsView.tsx';
import { VolumeUsageView } from './components/views/VolumeUsageView.tsx';
import { DockerPullModal } from './components/modals/DockerPullModal.tsx';
import { CreateServerModal } from './components/modals/CreateServerModal.tsx';
import { CreateCategoryModal } from './components/modals/CreateCategoryModal.tsx';
import { DeleteServerModal } from './components/modals/DeleteServerModal.tsx';
import { ConfigModal } from './components/modals/ConfigModal.tsx';
import { ServerMultiSelectModal } from './components/modals/ServerMultiSelectModal.tsx'
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
  bulkUpdateServerVersionApi,
  bulkRestartServerVersionApi,
  updateServerLanguageApi,
  updateServerCalendarApi,
  updateServerOpenAccessApi,
  updateServerLabelApi,
  fetchAllServerUserLogs,
  fetchVolumeUsage,
  fetchCategoriesApi,
  fetchVolumesApi,
} from './services.ts';
import { ToastContainer } from './components/modals/Toast.tsx';
import { addToast } from './stores/toastStore.ts';
import { Users } from "./components/views/users/Users.tsx";

function App() {
  const { getToken } = useAuth();

  // get server data
  const [servers, { mutate, refetch: refetchServers }] = createResource(fetchServerCardData)

  // get server categories
  const [categories, { refetch: refetchDynamicCategories }] = createResource(async () => {
    const token = await getToken();
    return fetchCategoriesApi(token);
  });

  // get available volumes
  const [volumes] = createResource(async () => {
    const token = await getToken();
    return fetchVolumesApi(token);
  });

  // get server status, total users, uptime, etc
  const [statuses, { refetch: refetchStatuses }] = createResource(
    servers,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerStatuses(serverList, token);
    }
  );

  // get user logs for all servers (fetched once on load), keyed by server id
  const [allServerUserLogs] = createResource(
    servers,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerUserLogs(serverList, token);
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

  // track create server modal
  const [createServerModalOpen, setCreateServerModalOpen] = createSignal<boolean>(false);

  // track create category modal
  const [createCategoryModalOpen, setCreateCategoryModalOpen] = createSignal<boolean>(false);

  // track delete server modal
  const [deleteServerModalId, setDeleteServerModalId] = createSignal<string | null>(null);

  // track config modal
  const [configModalServerId, setConfigModalServerId] = createSignal<string | null>(null);

  // track which server's logs to show in modal
  const [logsModalServerId, setLogsModalServerId] = createSignal<string | null>(null);
  const [modalLogs, setModalLogs] = createSignal<string>('');
  const [logsLoading, setLogsLoading] = createSignal<boolean>(false);

  // track which servers I have multi selected
  const [multiSelectMode, setMultiSelectMode] = createSignal(false);
  const [multiSelectedServerIds, setMultiSelectedServerIds] = createSignal<string[] | null>([]);

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

  // fetch volume usage for all unique volumes across servers
  const [volumeUsages, { refetch: refetchVolumeUsages }] = createResource(
    servers,
    async (serverList) => {
      const token = await getToken();
      const uniqueVolumes = [...new Set(serverList.flatMap(s => s.volume ? [s.volume] : []))];
      const entries = await Promise.all(
        uniqueVolumes.map(async (v) => [v, await fetchVolumeUsage(v, token)] as const)
      );
      return Object.fromEntries(entries) as Record<string, import('./types.ts').VolumeUsage | null>;
    }
  );

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

  const activeInstances = () => (servers() || []).filter(s => {
    const log = statuses()?.[s.id]?.lastUserLog;
    return log && Date.now() - new Date(log.timestamp).getTime() < 30 * 60 * 1000;
  });

  // server list filters
  const [searchQuery, setSearchQuery] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal<'all' | 'online' | 'offline'>('all');
  const [versionFilter, setVersionFilter] = createSignal('all');
  const [lockedFilter, setLockedFilter] = createSignal<'all' | 'locked' | 'unlocked'>('all');

  const availableVersions = () => [...new Set((servers() || []).map(s => s.serverVersion))].sort();

  const filteredServers = () => {
    const query = searchQuery().toLowerCase();
    return (servers() || []).filter(s => {
      if (query && !s.label.toLowerCase().includes(query) && !s.id.toLowerCase().includes(query)) return false;
      if (statusFilter() === 'online' && !statuses()?.[s.id]?.running) return false;
      if (statusFilter() === 'offline' && statuses()?.[s.id]?.running) return false;
      if (versionFilter() !== 'all' && s.serverVersion !== versionFilter()) return false;
      if (lockedFilter() === 'locked' && !lockedServers().has(s.id)) return false;
      if (lockedFilter() === 'unlocked' && lockedServers().has(s.id)) return false;
      return true;
    });
  };

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
        refetchStatuses();
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

  // bulk update server versions
  const bulkUpdateServerVersion = async (serverIds: string[], version: string) => {
    if (sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', "info");
      return;
    }

    setSshOperationInProgress(true);

    try {
      const token = await getToken();
      const result = await bulkUpdateServerVersionApi(serverIds, version, token);

      if (result.success) {
        addToast(`Servers updated successfully to version ${version}`, "success");

        const currentServers = servers();
        if (currentServers) {
          const updatedServers = currentServers.map((server) =>
            serverIds.includes(server.id)
              ? { ...server, serverVersion: version }
              : server
          );
          mutate(updatedServers);
        }

        await new Promise(resolve => setTimeout(resolve, 1000)); // waits one second in between ssh calls so it doesn't overload the server
        await bulkRestartServerInternal(serverIds);
      } else {
        addToast(`Error: ${result.error}`, "error");
      } 
    } catch (error) {
      addToast(`Failed to update server: ${error}`, "error");
    } finally {
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
  const handleFetchSessions = async (userId: string, since?: number) => {
    const token = await getToken();
    return getUserSessionsApi(userId, token, since);
  };

  const handleFetchActivity = async (email: string, serverId: string | null): Promise<string[]> => {
    const logs = allServerUserLogs();
    if (!logs) return [];
    const serverIds = serverId ? [serverId] : Object.keys(logs);
    const activeDays = new Set<string>();
    for (const id of serverIds) {
      for (const log of logs[id] ?? []) {
        if (log.user_email === email && log.endpoint === 'getInstanceDetail') activeDays.add(log.timestamp.slice(0, 10));
      }
    }
    return [...activeDays].sort();
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

  const handleSaveConfig = async (
    serverId: string,
    changes: { french?: boolean; ethiopian?: boolean; openAccess?: boolean; label?: string },
  ) => {
    if (sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', 'info');
      return;
    }
    setSshOperationInProgress(true);
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
      mutate(prev => prev?.map(s => s.id === serverId ? { ...s, ...changes } : s));
      addToast('Configuration saved', 'success');
      setConfigModalServerId(null);
    } catch (error) {
      addToast(`Error: ${error}`, 'error');
    } finally {
      setSshOperationInProgress(false);
    }
  };

  return (
    <>
      <ToastContainer />
      <div class="sticky-header">
        <h1>STATUS</h1>
        <SignedIn>
          <Show when={isAdmin()}>
            <div class="button-container">
              <div class="nav-left">
                {activeView() === "servers" && (
                  <div>
                    <button
                      type="button"
                      class={`multi-select-toggle ${multiSelectMode() ? 'active' : ''}`}
                      style="margin-left: 8px"
                      onClick={() => {
                        if (multiSelectMode()) setMultiSelectedServerIds([]);
                        setMultiSelectMode(m => !m);
                      }}
                    >
                      {multiSelectMode() ? `Cancel (${multiSelectedServerIds()!.length} selected)` : 'Select Servers'}
                    </button>
                    <Show when={multiSelectMode()}>
                      <button
                        type="button"
                        class={`multi-select-toggle ${multiSelectMode() ? 'active' : ''}`}
                        style="margin-left: 8px"
                        onClick={() => setMultiSelectedServerIds(
                          (servers()?.filter(s => !lockedServers().has(s.id)).map(s => s.id)) ?? []
                        )}
                      >
                        Select all
                      </button>
                    </Show>
                    <button
                      type="button"
                      style="margin-left: 8px"
                      onClick={() => setCreateCategoryModalOpen(true)}
                    >
                      Create Category
                    </button>
                    <button
                      type="button"
                      style="margin-left: 8px"
                      onClick={() => setCreateServerModalOpen(true)}
                    >
                      Create Server
                    </button>
                  </div>
                )}
              </div>
              <div class="nav-buttons">
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
                  data-selected={activeView() === "volumeUsage"}
                  onClick={() => setActiveView("volumeUsage")}
                >
                  Volume Usage
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
              <div class="nav-right" />
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
            {(servers.loading || categories.loading) && <h2 class="loading-text">Loading...</h2>}
            {servers.error && <p>Error: {servers.error.message}</p>}
            {servers() && categories() && (
              <div class="servers-container">
                <ActiveInstancesBar instances={activeInstances()} statuses={statuses()} loading={statuses.loading} />
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
                  const cats = categories() || [];
                  const allIds = new Set(cats.flatMap(cat => cat.servers));
                  return [...cats, { name: "Misc", servers: (servers() || []).filter(s => !allIds.has(s.id)).map(s => s.id) }];
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
                                  status={statuses()?.[server.id] ?? null}
                                  isLoading={statuses.loading && statuses() === undefined}
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
                                  multiSelectMode={multiSelectMode()}
                                  isSelected={multiSelectedServerIds()!.includes(server.id)}
                                  onToggleSelect={(id) => setMultiSelectedServerIds(prev =>
                                    prev!.includes(id) ? prev!.filter(x => x !== id) : [...prev!, id]
                                  )}
                                  onDelete={(id) => setDeleteServerModalId(id)}
                                  onConfig={(id) => setConfigModalServerId(id)}
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

                {/* Logs Modal */}
                {logsModalServerId() && (
                  <LogsModal
                    serverId={logsModalServerId()!}
                    logs={modalLogs()}
                    loading={logsLoading()}
                    onClose={closeLogsModal}
                  />
                )}

                {/* bulk select modal */}
                {(multiSelectedServerIds()?.length ?? 0) > 0 && (
                  <ServerMultiSelectModal
                    serverIds={multiSelectedServerIds()!}
                    versions={serverVersions() || []}
                    sshOperationInProgress={sshOperationInProgress()}
                    onUpdate={bulkUpdateServerVersion}
                  />
                )}
              </div>
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

          <Show when={activeView() === "volumeUsage"}>
            <VolumeUsageView
              servers={servers()}
              volumeUsages={volumeUsages() ?? {}}
              loading={volumeUsages.loading}
              error={volumeUsages.error}
              onRefetch={refetchVolumeUsages}
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
              onFetchActivity={handleFetchActivity}
              servers={servers()}
              userLogs={allServerUserLogs()}
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

        {/* Create Server Modal */}
        {createServerModalOpen() && (
          <CreateServerModal
            sshOperationInProgress={sshOperationInProgress}
            setSshOperationInProgress={setSshOperationInProgress}
            onClose={() => setCreateServerModalOpen(false)}
            onCreated={() => { setCreateServerModalOpen(false); refetchServers(); refetchDynamicCategories(); }}
            getToken={getToken}
            categories={() => categories() || []}
            volumes={() => volumes() || []}
          />
        )}

        {/* Create Category Modal */}
        {createCategoryModalOpen() && (
          <CreateCategoryModal
            onClose={() => setCreateCategoryModalOpen(false)}
            onCreated={() => { setCreateCategoryModalOpen(false); refetchDynamicCategories(); }}
            getToken={getToken}
          />
        )}

        {/* Config Modal */}
        {configModalServerId() && (
          <ConfigModal
            server={servers()!.find(s => s.id === configModalServerId())!}
            sshOperationInProgress={sshOperationInProgress()}
            onClose={() => setConfigModalServerId(null)}
            onSave={handleSaveConfig}
          />
        )}

        {/* Delete Server Modal */}
        {deleteServerModalId() && (
          <DeleteServerModal
            serverId={deleteServerModalId()!}
            onClose={() => setDeleteServerModalId(null)}
            onDeleted={() => { setDeleteServerModalId(null); refetchServers(); }}
            getToken={getToken}
          />
        )}
      </SignedIn>
    </>
  )
}

export default App
