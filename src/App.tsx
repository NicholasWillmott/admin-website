import { createResource } from 'solid-js'
import './App.css'

async function fetchServerData() {
  const response = await fetch('https://central.fastr-analytics.org/servers.json');
  return response.json()
}

function App() {
  // get server data
  const [servers] = createResource(fetchServerData)

  return (
    <>
      <h1>Servers Data</h1>
      {servers.loading && <p>Loading...</p>}
      {servers.error && <p>Error: {servers.error.message}</p>}
      {servers() && (
        <div class="servers-grid">
          {servers().map((server) => (
            <div class="server-card">
              <h2>{server.label}</h2>
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
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default App
