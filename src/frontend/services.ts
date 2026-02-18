import type { Server, ServerLogs, ServerStatuses, BackupInfo, HealthCheckResponse } from './types.ts';

export const API_BASE = import.meta.env.VITE_API_BASE || "https://status-api.fastr-analytics.org";

function getAuthHeaders(token: string | null): HeadersInit {
  const headers: HeadersInit = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchServerCardData(): Promise<Server[]> {
  const response = await fetch('https://central.fastr-analytics.org/servers.json');
  return response.json();
}

export async function fetchServerLogs(serverId: string, token: string | null): Promise<ServerLogs | null> {
  try {
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/logs`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`failed to fetch server logs for ${serverId}: `, error);
    return null;
  }
}

export async function fetchServerBackups(serverId: string, token: string | null): Promise<BackupInfo[]> {
  try {
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/backups`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.backups || [];
  } catch (error) {
    console.error(`Failed to fetch backups for ${serverId}`, error);
    return [];
  }
}

export async function fetchServerStatus(serverId: string, token: string | null): Promise<HealthCheckResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/status`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch status for ${serverId}:`, error);
    return null;
  }
}

export async function fetchAllServerStatuses(servers: Server[], token: string | null): Promise<ServerStatuses> {
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

export async function fetchServerVersions(token: string | null): Promise<string[]> {
  try {
    const response = await fetch(`${API_BASE}/api/versions`, {
      headers: getAuthHeaders(token),
    });
    const data: { versions: string[] } = await response.json();
    return data.versions;
  } catch (error) {
    console.error("Failed to fetch server versions:", error);
    return [];
  }
}

export async function dockerPull(version: string, token: string | null): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/api/docker/pull/${version}`, {
      method: 'POST',
      headers: getAuthHeaders(token),
    });
    if (response.ok) {
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

export async function downloadBackupFile(serverId: string, folder: string, file: string, token: string | null): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE}/api/servers/${serverId}/backups/${folder}/${file}`,
      { headers: getAuthHeaders(token) }
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
}

export async function downloadEntireBackup(serverId: string, folder: string, token: string | null): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE}/api/servers/${serverId}/backups/${folder}/download-all`,
      { headers: getAuthHeaders(token) }
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
}

export async function deleteVolumeSnapshotApi(snapshotId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/server/snapshot/${snapshotId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });
  return await response.json();
}

export async function createVolumeSnapshotApi(token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/server/snapshot`, {
    method: 'POST',
    headers: getAuthHeaders(token),
  });
  return await response.json();
}

export async function fetchVolumeSnapshots(token: string | null): Promise<any[]> {
  const response = await fetch(`${API_BASE}/api/servers/snapshots`, {
    headers: getAuthHeaders(token),
  });
  const data = await response.json();
  return data.snapshots || [];
}

export async function updateServerVersionApi(serverId: string, version: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/${serverId}/update`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version }),
  });
  return await response.json();
}

export async function restartServerApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/${serverId}/restart`, {
    method: 'POST',
    headers: getAuthHeaders(token),
  });
  return await response.json();
}

export async function backupServerApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/${serverId}/backup`, {
    method: 'POST',
    headers: getAuthHeaders(token),
  });
  return await response.json();
}
