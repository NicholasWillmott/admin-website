import { addToast } from './stores/toastStore.ts';
import type { Server, ServerLogs, ServerStatuses, BackupInfo, HealthCheckResponse, ClerkUser, ClerkSession, UserLog, ServerUserLogs, VolumeUsage } from './types.ts';

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

export async function fetchServerUserLogs(serverId: string, token: string | null): Promise<UserLog[]> {
  try {
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/user_logs`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.logs ?? [];
  } catch {
    return [];
  }
}

export async function fetchAllServerUserLogs(servers: Server[], token: string | null): Promise<ServerUserLogs> {
  const results = await Promise.all(servers.map(async (server) => ({
    id: server.id,
    logs: await fetchServerUserLogs(server.id, token),
  })));
  return results.reduce((acc, { id, logs }) => {
    acc[id] = logs;
    return acc;
  }, {} as ServerUserLogs);
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
      addToast(`Docker image for version ${version} pulled successfully!`, "success");
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
      addToast('Failed to download backup file', "error");
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
    addToast(`Error downloading file: ${error}`, "error");
  }
}

export async function downloadEntireBackup(serverId: string, folder: string, token: string | null): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE}/api/servers/${serverId}/backups/${folder}/download-all`,
      { headers: getAuthHeaders(token) }
    );

    if (!response.ok) {
      addToast('Failed to download entire backup', "error");
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
    addToast(`Error downloading entire backup: ${error}`, "error");
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

export async function fetchVolumeUsage(volumeName: string, token: string | null): Promise<VolumeUsage | null> {
  try {
    const response = await fetch(`${API_BASE}/api/volumes/usage?volume=${encodeURIComponent(volumeName)}`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.success ? data : null;
  } catch (error) {
    console.error(`Failed to fetch volume usage for ${volumeName}:`, error);
    return null;
  }
}

export async function fetchVolumeSnapshots(token: string | null): Promise<any[]> {
  const response = await fetch(`${API_BASE}/api/servers/snapshots`, {
    headers: getAuthHeaders(token),
  });
  const data = await response.json();
  return data.snapshots || [];
}

export async function bulkUpdateServerVersionApi(serverIds: string[], version: string, token: string | null): Promise<{ success: boolean; error?: string}> {
  const response = await fetch(`${API_BASE}/api/servers/bulk-update`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: serverIds, version }),
  }); 
  return await response.json();
}

export async function bulkRestartServerVersionApi(serverIds: string[], token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/bulk-restart`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: serverIds }),
  });
  return await response.json();
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

export async function getUsersApi(token: string | null): Promise<ClerkUser[]> {
  try {
    const response = await fetch(`${API_BASE}/api/users`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch users:", error);
    return [];
  }
}

export async function getUserSessionsApi(userId: string, token: string | null, since?: number): Promise<ClerkSession[]> {
  try {
    const url = since
      ? `${API_BASE}/api/users/${userId}/sessions?since=${since}`
      : `${API_BASE}/api/users/${userId}/sessions`;
    const response = await fetch(url, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch sessions for user ${userId}:`, error);
    return [];
  }
}

export async function getUserActivityApi(serverId: string, email: string, token: string | null): Promise<string[]> {
  try {
    const response = await fetch(`${API_BASE}/api/servers/${serverId}/user_activity?email=${encodeURIComponent(email)}`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return [];
    const data: { activeDays: string[] } = await response.json();
    return data.activeDays ?? [];
  } catch (error) {
    console.error(`Failed to fetch user activity for ${email} on ${serverId}:`, error);
    return [];
  }
}

export async function fetchLockedServersApi(token: string | null): Promise<string[]> {
  try {
    const response = await fetch(`${API_BASE}/api/servers/locks`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch locked servers:', error);
    return [];
  }
}

export async function lockServerApi(serverId: string, token: string | null): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/servers/${serverId}/lock`, {
      method: 'POST',
      headers: getAuthHeaders(token),
    });
  } catch (error) {
    console.error(`Failed to lock server ${serverId}:`, error);
  }
}

export async function unlockServerApi(serverId: string, token: string | null): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/servers/${serverId}/lock`, {
      method: 'DELETE',
      headers: getAuthHeaders(token),
    });
  } catch (error) {
    console.error(`Failed to unlock server ${serverId}:`, error);
  }
}

export async function updateServerLanguageApi(serverId: string, french: boolean, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/update/language`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, french }),
  });
  return await response.json();
}

export async function updateServerCalendarApi(serverId: string, ethiopian: boolean, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/update/calendar`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, ethiopian }),
  });
  return await response.json();
}

export async function updateServerOpenAccessApi(serverId: string, openAccess: boolean, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/update/open-access`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, openAccess }),
  });
  return await response.json();
}

export async function createDnsRecordApi(subdomain: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/record`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdomain }),
  });
  return await response.json();
}

export async function createServerApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/server`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function initDirsApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/dirs`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function initNginxApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/nginx`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function initSslApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/ssl`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function updateServerLabelApi(serverId: string, newLabel: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/update/label`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, newLabel }),
  });
  return await response.json();
}

export async function updateServerVolumeApi(serverId: string, volume: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/update/volume`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, volume }),
  });
  return await response.json();
}

export async function runServerApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch (`${API_BASE}/api/servers/run`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json'},
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function deleteDnsRecordApi(subdomain: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/remove/record`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdomain }),
  });
  return await response.json();
}

export async function removeServerApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/remove/server`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function removeNginxApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/remove/nginx`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function removeSslApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/remove/ssl`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function removeDirsApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/remove/dirs`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export interface ServerConflicts {
  dns: boolean;
  config: boolean;
  nginx: boolean;
  ssl: boolean;
  serversJson: boolean;
  directory?: boolean;
}

export async function fetchVolumesApi(token: string | null): Promise<string[]> {
  try {
    const response = await fetch(`${API_BASE}/api/volumes/list`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.volumes ?? [];
  } catch {
    return [];
  }
}

export async function checkServerConflictsApi(serverId: string, token: string | null, volume?: string): Promise<ServerConflicts | null> {
  try {
    const url = new URL(`${API_BASE}/api/servers/create/check/${serverId}`);
    if (volume) url.searchParams.set('volume', volume);
    const response = await fetch(url.toString(), {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.conflicts ?? null;
  } catch {
    return null;
  }
}

export interface ServerCategory {
  name: string;
  servers: string[];
}

export async function fetchCategoriesApi(token: string | null): Promise<ServerCategory[]> {
  try {
    const response = await fetch(`${API_BASE}/api/servers/categories`, {
      headers: getAuthHeaders(token),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.categories ?? [];
  } catch {
    return [];
  }
}

export async function createCategoryApi(name: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/category`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return await response.json();
}

export async function assignServerCategoryApi(serverId: string, category: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/assign-category`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, category }),
  });
  return await response.json();
}

export async function renameCategoryApi(oldName: string, newName: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/category`, {
    method: 'PUT',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldName, newName }),
  });
  return await response.json();
}

export async function deleteCategoryApi(name: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/create/category/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });
  return await response.json();
}

export async function stopServerApi(serverId: string, token: string | null): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`${API_BASE}/api/servers/stop`, {
    method: 'POST',
    headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId }),
  });
  return await response.json();
}

export async function sendWeeklySuperAdminReportApi(token: string | null): Promise<{ success: boolean; sentTo?: number; error?: string }> {
  const response = await fetch(`${API_BASE}/api/emails/superadmin-email`, {
    method: 'POST',
    headers: getAuthHeaders(token),
  });
  return await response.json();
}
