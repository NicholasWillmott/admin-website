import { createResource, createSignal, For, Show, createEffect, onCleanup } from 'solid-js'
import './css/App.css'
import { SERVER_CATEGORIES } from './serverCategories.ts'
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser, useAuth } from 'clerk-solidjs'

const API_BASE = import.meta.env.VITE_API_BASE || "https://status-api.fastr-analytics.org";

interface Server {
  id: string;
  label: string;
  port: number;
  serverVersion: string;
  instanceDir?: string;
  adminVersion?: string;
  french?: boolean;
  ethiopian?: boolean;
  openAccess?: boolean;
}

interface ServerLogs {
  success: boolean;
  logs: string;
  error: string;
}

// Health check response structure for the server status api call
interface HealthCheckResponse {
  running: boolean;
  instanceName: string;
  serverVersion: string;
  environment: string;
  startTime: string;
  currentTime: string;
  uptimeMs: number;
  calendar: string;
  language: string;
  databaseFolder: string;
  totalUsers: number;
  adminUsers: string[];
  projects: string[];
  datasets: {
    hmis: { versionId: number } | null;
    hfa: any;
  };
}

// stores all the servers HealthCheckResponses
interface ServerStatuses {
  [serverId: string]: HealthCheckResponse | null;
}

type ServerRestartStatus = 'idle' | 'pending' | 'online';

interface BackupInfo {
  folder: string;
  timestamp: string;
  backup_date: string;
  total_projects: number;
  backed_up_projects: number;
  size: number;
  file_count: number;
  files: BackupFileInfo[];
}

interface BackupFileInfo {
  name: string;
  size: number;
  type: 'main' | 'project' | 'metadata' | 'log' | 'other';
}

function formatUptime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) {
    return `${days} day${days === 1 ? '' : 's'}`;
  } else if (hours >= 1) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  } else {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
}

async function fetchServerCardData(): Promise<Server[]> {
  const response = await fetch('https://central.fastr-analytics.org/servers.json');
  return response.json()
}

async function fetchServerLogs(serverId: string, token: string | null): Promise<ServerLogs | null> {
  try{
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/logs`, { headers });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`failed to fetch server logs for ${serverId}: `, error);
    return null;
  }
}

async function fetchServerBackups(serverId: string, token: string | null): Promise<BackupInfo[]> {
  try {
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/backups`, { headers });
    if (!response.ok) return [];

    const data = await response.json();
    return data.backups || [];
  } catch (error) {
    console.error(`Failed to fetch backups for ${serverId}`, error);
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

  function formatDate(isoString: string): string {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

async function fetchServerStatus(serverId: string, token: string | null): Promise<HealthCheckResponse | null> {
  try {
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/status`, { headers });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch status for ${serverId}:`, error);
    return null;
  }
}

async function fetchAllServerStatuses(servers: Server[], token: string | null): Promise<ServerStatuses> {
  const statusPromises = servers.map(async (server) => ({
    id: server.id,
    status: await fetchServerStatus(server.id, token),
  }));

  const results = await Promise.all(statusPromises);

  return results.reduce((acc, { id, status }) => {
    acc[id] = status;
    return acc;
  }, {} as ServerStatuses);
}


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
  const [dockerPullVersion, setDockerPullVersion] = createSignal<string>('');

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
  const [expandedBackup, setExpandedBackup] = createSignal<string | null>(null);

  // track when an ssh operation is happening to stop other ssh operations from occuring
  const [sshOperationInProgress, setSshOperationInProgress] = createSignal<boolean>(false);

  // track loading volume snapshots
  const [volumeSnapshots, { refetch: refetchSnapshots }] = createResource(async () => {
    const token = await getToken();
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE}/api/servers/snapshots`, { headers });
    const data = await response.json();
    return data.snapshots || [];
  })

  // Track active view: servers or snapshots
  type ViewType = "servers" | "snapshots";
  const [activeView, setActiveView] = createSignal<ViewType>("servers");

  // Sorted snapshots (newest first)
  const sortedSnapshots = () => {
    const snapshots = volumeSnapshots();
    if (!snapshots) return [];
    return [...snapshots].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  };


  // Auto-refresh statuses every 60 seconds
  createEffect(() => {
    const interval = setInterval(() => {
      refetchStatuses();
    }, 60000); // 60 seconds

    onCleanup(() => clearInterval(interval));
  });

  const { user: currentUser } = useUser();
  const isAdmin = () => currentUser()?.publicMetadata?.isAdmin === true;

  // toggle card
  const toggleCard = (id: string) => {
    setExpandedId(expandedId() === id ? null : id)
  }

  // open docker pull modal
  const openDockerPullModal = () => {
    setDockerPullModalOpen(true);
  };

  const closeDockerPullModal = () => {
    setDockerPullModalOpen(false);
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

  // close logs modal
  const closeLogsModal = () => {
    setLogsModalServerId(null);
    setModalLogs('');
  };

  // open backups modal
  const openBackupsModal = async (serverId: string) => {
    setBackupsModalServerId(serverId);
    setBackupsLoading(true);
    setExpandedBackup(null);

    const token = await getToken();
    const backups = await fetchServerBackups(serverId, token);
    setBackupsList(backups);
    setBackupsLoading(false);
  };

  // close backups modal
  const closeBackupsModal = () => {
    setBackupsModalServerId(null);
    setBackupsList([]);
    setExpandedBackup(null);
  };

  // toggle expanded backup view
  const toggleBackupExpand = (folder: string) => {
    setExpandedBackup(expandedBackup() === folder ? null : folder);
  };

  // fetch server versions helper function
  const fetchServerVersions = async (token: string | null): Promise<string[]> => {
    try{
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${API_BASE}/api/versions`, { headers });
      const data: { versions: string[] } = await response.json();
      return data.versions;
    } catch (error) {
      console.error("Failed to fetch server versions:", error);
      return [];
    }
  };

  // docker pull version
  async function dockerPull(version: string) {
    try {
      const token = await getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${API_BASE}/api/docker/pull/${version}`, 
        { 
          method: 'POST',
          headers 
        }
      );
      if(response.ok) {
        alert(`Docker image for version ${version} pulled successfully!`);
        return await response.json();
      } else {
        return null;
      }
    } catch (error) {
      console.error(`failed to pull version ${version}:`, error);
      return null;
    }
  }

  // download backup file
  const downloadBackupFile = async (serverId: string, folder: string, file: string) => {
    try {
      const token = await getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(
        `${API_BASE}/api/servers/${serverId}/backups/${folder}/${file}`,
        { headers }
      );

      if (!response.ok) {
        alert('Failed to download backup file');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert(`Error downloading file: ${error}`);
    }
  };

  // download entire backup folder
  const downloadEntireBackup = async (serverId: string, folder: string) => {
    try {
      const token = await getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(
        `${API_BASE}/api/servers/${serverId}/backups/${folder}/download-all`,
        { headers }
      );

      if (!response.ok) {
        alert('Failed to download entire backup');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${serverId}_${folder}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert(`Error downloading entire backup: ${error}`);
    }
  };

  // poll server logs until startup message is found
  const pollServerLogsForStartup = async (serverId: string) => {
    const maxAttempts = 400; // 400 attempts = 35 minutes with 5 second intervals
    let attempts = 0;

    const checkLogs = async (): Promise<boolean> => {
      attempts++;

      try {
        const token = await getToken();
        const result = await fetchServerLogs(serverId, token);

        if (result?.success && result.logs.includes('Listening on http://0.0.0.0:8000/')) {
          return true; // Server is up
        }

        if (attempts >= maxAttempts) {
          console.error(`Server ${serverId} did not start after ${maxAttempts} attempts`);
          return false;
        }

        // Wait 5 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 5000));
        return await checkLogs();

      } catch (error) {
        console.error(`Error checking logs for ${serverId}:`, error);

        if (attempts >= maxAttempts) {
          return false;
        }

        // Wait 5 seconds before retry
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
      const response = await fetch(`${API_BASE}/api/server/snapshot/${snapshotId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const result = await response.json();
      if (result.success) {
        alert('Snapshot deleted successfully!');
        refetchSnapshots();
      } else {
        alert(`Failed to delete snapshot: ${result.error}`);
      }
    } catch (error) {
      alert(`Error deleting snapshot: ${error}`);
    }
  };

  // create snapshot of volume
  const createVolumeSnapshot = async () => {
    setSnappingVolume(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/api/server/snapshot`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const result = await response.json();
      if (result.success) {
        alert(`Volume snpashot created successfully!`);
      } else {
        alert(`Failed to create snapshot: ${result.error}`);
      }
    } catch (error) {
      alert(`Error creating snpashot: ${error}`);
    } finally {
      setSnappingVolume(false);
    }
  };

  // update server version
  const updateServerVersion = async (serverId: string, version: string) => {
    if(sshOperationInProgress()) return;
    setSshOperationInProgress(true);
    setUpdatingServerId(serverId);
    try{
      const token = await getToken();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${API_BASE}/api/servers/${serverId}/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ version }),
      });
      const result = await response.json();
      if (result.success) {
        alert(`${serverId} Server updated successfully to version ${version}.`);

        // Update the local data without refetching (prevents scroll jump)
        const currentServers = servers();
        if (currentServers) {
          const updatedServers = currentServers.map((server) =>
            server.id === serverId
              ? { ...server, serverVersion: version }
              : server
          );
          mutate(updatedServers);
        }

        // Wait a moment before restarting to ensure the update command has fully completed
        // and the SSH connection is properly closed
        await new Promise(resolve => setTimeout(resolve, 1000));

        // restart server after update
        await restartServer(serverId);

      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      alert(`Failed to update server: ${error}`);
    } finally {
      setUpdatingServerId(null);
      setSshOperationInProgress(false);
    }
  }

  // restart server
  const restartServer = async (ServerId: string) => {
    if(sshOperationInProgress()) return;
    setSshOperationInProgress(true);

    setRestartingServerId(ServerId);

    // Set status to pending
    setServerRestartStatuses(prev => ({ ...prev, [ServerId]: 'pending' }));

    try{
      const token = await getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`${API_BASE}/api/servers/${ServerId}/restart`, {
        method: 'POST',
        headers,
      });
      const result = await response.json();
      if (result.success) {
        // Start polling logs for startup message
        const isOnline = await pollServerLogsForStartup(ServerId);

        if (isOnline) {
          setServerRestartStatuses(prev => ({ ...prev, [ServerId]: 'online' }));
          alert(`Server ${ServerId} restarted successfully and is now online.`);
          // Refresh server status to update UI
          refetchStatuses();
        } else {
          setServerRestartStatuses(prev => ({ ...prev, [ServerId]: 'idle' }));
          alert(`Server ${ServerId} restart command sent, but failed to detect online status.`);
        }
      } else {
        setServerRestartStatuses(prev => ({ ...prev, [ServerId]: 'idle' }));
        alert(`Failed to restart server ${ServerId}: ${result.error}`);
      }
    } catch (error) {
      setServerRestartStatuses(prev => ({ ...prev, [ServerId]: 'idle' }));
      alert(`Error restarting server ${ServerId}: ${error}`);
    } finally {
      setRestartingServerId(null);
      setSshOperationInProgress(false);
    }
  }

  // backup server
  const backupServer = async (ServerId: string) => {
    setBackingUpServerId(ServerId);

    try {
      const token = await getToken();
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE}/api/servers/${ServerId}/backup`, {
        method: 'POST',
        headers,
      });
      const result = await response.json();

      if (result.success) {
        alert(`Backup created successfully for ${ServerId}`);
      } else {
        alert(`Failed to backup ${ServerId}: ${result.error}`);
      }
    } catch (error) {
      alert(`Error backing up server ${ServerId}: ${error}`);
    } finally {
      setBackingUpServerId(null);
    }
  }

 
  return (
    <>
      <div class="sticky-header">
        <h1>Fastr Analytics Admin Dashboard</h1>
        <SignedIn>
          <Show when={isAdmin()}>
            <div class="button-container">
              <button
                data-selected={activeView() === "servers"}
                onClick={() => setActiveView("servers")}  
              >
                Servers
              </button>
              <button
                data-selected={activeView() === "snapshots"}
                onClick={() => setActiveView("snapshots")}
              >
                Snapshots
              </button>
              <button
                onClick={() => openDockerPullModal()}
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
                <For each={SERVER_CATEGORIES}>
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
                              {(server) =>{
                                const isExpanded = () => expandedId() === server.id
                                const [selectedVersion, setSelectedVersion] = createSignal(server.serverVersion);

                                return (
                                  <div class={`server-card ${isExpanded() ? 'expanded' : ''}`} onClick={() => toggleCard(server.id)}>
                                    {/*Collapsed View*/}
                                    <div class="card-header">
                                      <a href={`https://${server.id}.fastr-analytics.org`} target="_blank" onClick={(e) => e.stopPropagation()}>
                                        <h2>{server.label}</h2>
                                      </a>
                                      <span class="expand-icon">{isExpanded() ? '▼' : '▶'}</span>
                                    </div>
                                    <p><strong>ID:</strong> {server.id}</p>
                                    <p><strong>Server Version:</strong> {server.serverVersion}</p>
                                    {server.adminVersion && <p><strong>Admin Version:</strong> {server.adminVersion}</p>}
                                    <p>
                                      <strong>Status:</strong>{' '}
                                      {(() => {
                                        const restartStatus = serverRestartStatuses()[server.id];
                                        if (restartStatus === 'pending') {
                                          return <span class="status-pending">Pending</span>;
                                        }
                                        return (
                                          <span class={statuses()?.[server.id]?.running ? "status-online" : "status-offline"}>
                                            {statuses()?.[server.id]?.running ? "Online" : "Offline"}
                                          </span>
                                        );
                                      })()}
                                    </p>
                                    <div class="flags">
                                      {server.french && <span class="badge">French</span>}
                                      {server.ethiopian && <span class="badge calendar">Ethiopian</span>}
                                      {server.openAccess && <span class="badge access">Open Access</span>}
                                    </div>

                                    {/* Expanded view */}
                                    {isExpanded() && (
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
                                              <For each={serverVersions()}>{(version) =>
                                                <option value={version} selected={server.serverVersion === version}>{version}</option>
                                              }</For>
                                            </select>
                                          </label>
                                          <button
                                            class="update-btn"
                                            onClick={() => updateServerVersion(server.id, selectedVersion())}
                                            disabled={updatingServerId() === server.id || sshOperationInProgress()}
                                          >
                                            {updatingServerId() === server.id ? (
                                              <>
                                                <span class="button-spinner"></span>
                                                Updating...
                                              </>
                                            ) : sshOperationInProgress() ? (
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
                                              <span class="stat-value">{statuses()?.[server.id]?.totalUsers ?? '0'}</span>
                                            </div>
                                            <div class="stat-item">
                                              <span class="stat-label">Uptime:</span>
                                              <span class="stat-value">
                                                {statuses()?.[server.id]?.uptimeMs
                                                  ? formatUptime(statuses()![server.id]!.uptimeMs)
                                                  : 'N/A'}
                                              </span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Admin Users */}
                                        <div class="admin-users-section">
                                          <h3>Admin Users ({statuses()?.[server.id]?.adminUsers?.length ?? 0})</h3>
                                          <div class="admin-users-grid">
                                            <For each={statuses()?.[server.id]?.adminUsers ?? []}>
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
                                            onClick={() => restartServer(server.id)}
                                            disabled={restartingServerId() === server.id || sshOperationInProgress}
                                          >
                                            {restartingServerId() === server.id ? (
                                              <>
                                                <span class="button-spinner"></span>
                                                Restarting...
                                              </>
                                            ) : sshOperationInProgress() ? (
                                              'SSH Operation in Progress...'
                                            ) : (
                                            
                                              'Restart Server'
                                            )}
                                          </button>
                                          <button
                                            class="action-btn backup"
                                            onClick={() => backupServer(server.id)}
                                            disabled={backingUpServerId() === server.id}
                                          >
                                            {backingUpServerId() === server.id ? (
                                              <>
                                                <span class="button-spinner"></span>
                                                Backing Up...
                                              </>
                                            ): (
                                              'Back Up Server'
                                            )}
                                          </button>
                                          <button class="action-btn" onClick={() => openBackupsModal(server.id)}>View Backups</button>
                                          <button class="action-btn" onClick={() => openLogsModal(server.id)}>View Logs</button>
                                          <button class="action-btn">Configuration</button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              }}
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
              <div class="modal-overlay" onClick={closeBackupsModal}>
                <div class="modal-content backups-modal" onClick={(e) => e.stopPropagation()}>
                  <div class="modal-header">
                    <h2>Backups: {backupsModalServerId()}</h2>
                    <button class="modal-close" onClick={closeBackupsModal}>✕</button>
                  </div>
                  <div class="modal-body">
                    {backupsLoading() ? (
                      <div class="logs-loading">
                        <div class="spinner"></div>
                        <p>Loading backups...</p>
                      </div>
                    ) : backupsList().length === 0 ? (
                      <div class="no-backups">
                        <p>No backups found for this server.</p>
                      </div>
                    ) : (
                      <div class="backups-list">
                        <For each={backupsList()}>
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
                                      onClick={() => downloadEntireBackup(backupsModalServerId()!, backup.folder)}
                                    >
                                      📥 Download Entire Backup ({formatBytes(backup.size)})
                                    </button>
                                  </div>

                                  <div class="backup-section-header">
                                    <span>Main Files</span>
                                  </div>
                                  <For each={backup.files.filter(f => f.type === 'main' || f.type === 'metadata' || f.type === 'log')}>
                                    {(file) => (
                                      <div class="backup-file" onClick={() => downloadBackupFile(backupsModalServerId()!, backup.folder, file.name)}>
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
                                      <div class="backup-file" onClick={() => downloadBackupFile(backupsModalServerId()!, backup.folder, file.name)}>
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
            )}

            {/* Logs Modal */}
            {logsModalServerId() && (
              <div class="modal-overlay" onClick={closeLogsModal}>
                <div class="modal-content" onClick={(e) => e.stopPropagation()}>
                  <div class="modal-header">
                    <h2>Server Logs: {logsModalServerId()}</h2>
                    <button class="modal-close" onClick={closeLogsModal}>✕</button>
                  </div>
                  <div class="modal-body">
                    {logsLoading() ? (
                      <div class="logs-loading">
                        <div class="spinner"></div>
                        <p>Loading logs...</p>
                      </div>
                    ) : (
                      <pre class="logs-display">{modalLogs()}</pre>
                    )}
                  </div>
                </div>
              </div>
            )}

            
          </Show>
          <Show when={activeView() === "snapshots"}>
            <div class="snapshots-container">
              <div class="snapshots-content">
                <div class="snapshots-header">
                  <button class="system-btn snapshot" onClick={createVolumeSnapshot} disabled={snappingVolume()}>
                    {snappingVolume() ? (
                      <>
                        <span class="button-spinner"></span>
                        Creating Volume Snapshot...
                      </>
                    ): (
                      'Create Volume Snapshot'
                    )}
                  </button>
                </div>

                {volumeSnapshots.loading ? (
                  <div class="snapshots-loading">
                    <div class="spinner"></div>
                    <p>Loading Snapshots</p>
                  </div>
                ) : volumeSnapshots.error ? (
                  <div class="snapshots-error">
                    <p>Error loading snapshots: {volumeSnapshots.error.message}</p>
                  </div>
                ) : volumeSnapshots() && volumeSnapshots().length === 0 ? (
                  <div class="no-snapshots">
                    <p>No volume snapshots found</p>
                  </div>
                ) : (
                  <div class="snapshots-table-container">
                    <table class="snapshots-table">
                      <thead>
                        <tr>
                          <th>Snapshot Name</th>
                          <th>Created</th>
                          <th>Size</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={sortedSnapshots()}>
                          {(snapshot) => (
                            <tr>
                              <td class="snapshot-name">{snapshot.name}</td>
                              <td class="snapshot-date">{formatDate(snapshot.created_at)}</td>
                              <td class="snapshot-size">{snapshot.size_gigabytes} GB</td>
                              <td class="snapshot-actions">
                                <button
                                  type="button"
                                  class="delete-btn"
                                  onClick={() => deleteVolumeSnapshot(snapshot.id)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </Show>
        </Show>
        {/* Docker Pull Modal */}
        {dockerPullModalOpen() && (
          <div class="modal-overlay" onClick={closeDockerPullModal}>
            <div class="modal-content" onClick={(e) => e.stopPropagation()}>
              <div class="modal-header">
                <h2>Docker Pull</h2>
                <button class="modal-close" onClick={closeDockerPullModal}>✕</button>
              </div>
              <div class="modal-body">
                <div class="docker-pull-form">
                  <label for="docker-version">Docker Version</label>
                  <input
                    id="docker-version"
                    type="text"
                    class="version-input"
                    value={dockerPullVersion()}
                    onInput={(e) => setDockerPullVersion(e.currentTarget.value)}
                    placeholder="Enter version (e.g., 1.0.0)"
                    autofocus
                  />
                  <button
                    type="button"
                    class="action-btn docker-pull"
                    onClick={async () => {
                      if (sshOperationInProgress()) {
                        alert('Please wait for the current operation to complete');
                        return;
                      }
                      
                      setSshOperationInProgress(true);
                      try {
                        await dockerPull(dockerPullVersion());
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        await refetchServerVersions();
                      } finally {
                        setSshOperationInProgress(false);
                      }
                    }}
                    disabled={!dockerPullVersion().trim() || sshOperationInProgress()}
                  >
                    Pull Docker Image
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </SignedIn>
    </>
  )
}

export default App
