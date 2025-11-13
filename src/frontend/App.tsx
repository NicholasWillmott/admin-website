import { createResource, createSignal, For } from 'solid-js'
import './css/App.css'

const API_BASE = "http://localhost:3001";

async function fetchServerData() {
  const response = await fetch('https://central.fastr-analytics.org/servers.json');
  return response.json()
}

const restartServer = async (ServerId: string) => {
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
  }
}

const updateServerVersion = async (serverId: string, version: string) => {
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
      alert(`Server updated: ${result.output}`);
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    alert(`Failed to update server: ${error}`);
  }
}

function App() {
  // get server data
  const [servers] = createResource(fetchServerData)

  // track expanded card
  const [expandedId, setExpandedId] = createSignal<string | null>(null)

  const toggleCard = (id: string) => {
    setExpandedId(expandedId() === id ? null : id)
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
                    <h2>{server.label}</h2>
                    <span class="expand-icon">{isExpanded() ? '▼' : '▶'}</span>
                  </div>
                  <p><strong>ID:</strong> {server.id}</p>
                  <p><strong>Port:</strong> {server.port}</p>
                  <p><strong>Server Version:</strong> {server.serverVersion}</p>
                  {server.instanceDir && <p><strong>Instance Dir:</strong> {server.instanceDir}</p>}
                  {server.adminVersion && <p><strong>Admin Version:</strong> {server.adminVersion}</p>}
                  <div class="flags">
                    {server.french && <span class="badge">French</span>}
                    {server.ethiopian && <span class="badge">Ethiopian</span>}
                    {server.openAccess && <span class="badge success">Open Access</span>}
                  </div>

                  {/* Expanded view */}
                  {isExpanded() && (
                    <div class="expanded-content" onClick={(e) => e.stopPropagation()}>
                      <hr/>
                      {/* Server Details */}
                      <div class="details-section">
                        <h3>Details</h3>
                        <p><strong>ID:</strong> {server.id}</p>
                        {server.instanceDir && <p><strong>Instance Dir:</strong> {server.instanceDir}</p>}
                        {server.adminVersion && <p><strong>Admin Version:</strong> {server.adminVersion}</p>}
                      </div>

                      {/* Version Control */}
                      <div class="control-section">
                        <h3>Version Control</h3>
                        <label>
                          <strong>Server Version:</strong>
                          <select class="version-select"
                            value={selectedVersion()}
                            onChange={(e) => setSelectedVersion(e.currentTarget.value)}
                          >
                            <option value="1.6.12" selected={server.serverVersion === '1.6.12'}>1.6.12</option>
                            <option value="1.6.11" selected={server.serverVersion === '1.6.11'}>1.6.11</option>
                            <option value="1.6.10" selected={server.serverVersion === '1.6.10'}>1.6.10</option>
                            <option value="1.6.9" selected={server.serverVersion === '1.6.9'}>1.6.9</option>
                            <option value="1.6.8" selected={server.serverVersion === '1.6.8'}>1.6.8</option>
                            <option value="1.6.7" selected={server.serverVersion === '1.6.7'}>1.6.7</option>
                            <option value="1.6.6" selected={server.serverVersion === '1.6.6'}>1.6.6</option>
                            <option value="1.6.5" selected={server.serverVersion === '1.6.5'}>1.6.5</option>
                          </select>
                        </label>
                        <button class="update-btn" onClick={() => updateServerVersion(server.id, selectedVersion())}>Update Version</button>
                      </div>

                      {/* Analytics */}
                      <div class="analytics-section">
                        <h3>Analytics</h3>
                        <div class="stats-grid">
                          <div class="stat-item">
                            <span class="stat-label">Current Users:</span>
                            <span class="stat-value">-</span>
                          </div>
                          <div class="stat-item">
                            <span class="stat-label">Uptime:</span>
                            <span class="stat-value">-</span>
                          </div>
                          <div class="stat-item">
                            <span class="stat-label">Last Updated:</span>
                            <span class="stat-value">-</span>
                          </div>
                          <div class="stat-item">
                            <span class="stat-label">Status:</span>
                            <span class="stat-value status-online">Online</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div class="actions-section">
                        <h3>Actions</h3>
                        <button class="action-btn restart" onClick={()=> restartServer(server.id)}>Restart Server</button>
                        <button class="action-btn">View Logs</button>
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
    </>
  )
}

export default App
