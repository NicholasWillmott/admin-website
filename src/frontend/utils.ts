// Parse semantic version string into components
export function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

// Filter versions to only show those >= current server's minor version
export function filterVersionsForServer(versions: string[], currentVersion: string): string[] {
  const current = parseVersion(currentVersion);
  if (!current) return versions;

  return versions.filter((v) => {
    const parsed = parseVersion(v);
    if (!parsed) return false;

    // Compare: same major and minor >= current, OR higher major
    if (parsed.major > current.major) return true;
    if (parsed.major === current.major && parsed.minor >= current.minor) return true;
    return false;
  });
}

export function formatUptime(ms: number): string {
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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function timeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatDate(isoString: string): string {
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
