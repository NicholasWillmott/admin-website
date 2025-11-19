import { createResource, createSignal, For, createEffect, onCleanup } from 'solid-js'
import './css/App.css'

const API_BASE = "https://status-api.fastr-analytics.org";

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

type serverVersions = string[];

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

async function fetchServerLogs(serverId: string): Promise<ServerLogs | null> {
  try{
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/logs`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`failed to fetch server logs for ${serverId}: `, error);
    return null;
  }
}

async function fetchServerVersions() {
  const response = await fetch(`${API_BASE}/api/versions`);
  const data: { versions: serverVersions } = await response.json();
  return data.versions;
}

async function fetchServerStatus(serverId: string): Promise<HealthCheckResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/status`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch status for ${serverId}:`, error);
    return null;
  }
}

async function fetchAllServerStatuses(servers: Server[]): Promise<ServerStatuses> {
  const statusPromises = servers.map(async (server) => ({
    id: server.id,
    status: await fetchServerStatus(server.id),
  }));
  
  const results = await Promise.all(statusPromises);
  
  return results.reduce((acc, { id, status }) => {
    acc[id] = status;
    return acc;
  }, {} as ServerStatuses);
}


function App() {
  // get server data
  const [servers, { mutate }] = createResource(fetchServerCardData)

  // get server status, total users, uptime, etc
  const [statuses, { refetch: refetchStatuses }] = createResource(
    servers,
    (serverList) => fetchAllServerStatuses(serverList)
  );

  // get server versions
  const [serverVersions] = createResource(fetchServerVersions);

  // track expanded card
  const [expandedId, setExpandedId] = createSignal<string | null>(null)
  
  // track which server's logs to show in modal
  const [logsModalServerId, setLogsModalServerId] = createSignal<string | null>(null);
  const [modalLogs, setModalLogs] = createSignal<string>('');
  const [logsLoading, setLogsLoading] = createSignal<boolean>(false);

  // track when updating server and restarting server ids are loading 
  const [updatingServerId, setUpdatingServerId] = createSignal<string | null>(null);
  const [restartingServerId, setRestartingServerId] = createSignal<string | null>(null);

  // Auto-refresh statuses every 60 seconds
  createEffect(() => {
    const interval = setInterval(() => {
      refetchStatuses();
    }, 60000); // 60 seconds

    onCleanup(() => clearInterval(interval));
  });

  // toggle card
  const toggleCard = (id: string) => {
    setExpandedId(expandedId() === id ? null : id)
  }

  // open logs modal
  const openLogsModal = async (serverId: string) => {
    setLogsModalServerId(serverId);
    setLogsLoading(true);
    
    const result = await fetchServerLogs(serverId);
    
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

  // update server version
  const updateServerVersion = async (serverId: string, version: string) => {
    setUpdatingServerId(serverId);
    try{
      const response = await fetch(`${API_BASE}/api/servers/${serverId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

        // restart server after update
        restartServer(serverId);

      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      alert(`Failed to update server: ${error}`);
    } finally {
      setUpdatingServerId(null);
    }
  }

  // restart server
  const restartServer = async (ServerId: string) => {
    setRestartingServerId(ServerId);
    try{
      const response = await fetch(`${API_BASE}/api/servers/${ServerId}/restart`, {
        method: 'POST',
      });
      const result = await response.json();
      if (result.success) {
        alert(`Server ${ServerId} restarted successfully.`);
      } else {
        alert(`Failed to restart server ${ServerId}: ${result.error}`);
      }
    } catch (error) {
      alert(`Error restarting server ${ServerId}: ${error}`);
    } finally {
      setRestartingServerId(null);
    }
  }


  return (
    <>
      <h1>Servers Data</h1>
      {servers.loading && <p>Loading...</p>}
      {servers.error && <p>Error: {servers.error.message}</p>}
      {servers() && (
        <div class="servers-grid">
          <For each={servers()}>
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
                  {server.instanceDir && <p><strong>Instance Dir:</strong> {server.instanceDir}</p>}
                  {server.adminVersion && <p><strong>Admin Version:</strong> {server.adminVersion}</p>}
                  <p>
                    <strong>Status:</strong>{' '}
                    <span class={statuses()?.[server.id]?.running ? "status-online" : "status-offline"}>
                      {statuses()?.[server.id]?.running ? "Online" : "Offline"}
                    </span>
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
                          disabled={updatingServerId() === server.id}
                        >
                          {updatingServerId() === server.id ? (
                            <>
                              <span class="button-spinner"></span>
                              Updating...
                            </>
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
                          disabled={restartingServerId() === server.id}
                        >
                          {restartingServerId() === server.id ? (
                            <>
                              <span class="button-spinner"></span>
                              Restarting...
                            </>
                          ) : (
                            'Restart Server'
                          )}
                        </button>
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
    </>
  )
}

export default App
