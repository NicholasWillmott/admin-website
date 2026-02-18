export interface Server {
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

export interface ServerLogs {
  success: boolean;
  logs: string;
  error: string;
}

// Health check response structure for the server status api call
export interface HealthCheckResponse {
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
export interface ServerStatuses {
  [serverId: string]: HealthCheckResponse | null;
}

export type ServerRestartStatus = 'idle' | 'pending' | 'online';

export interface BackupInfo {
  folder: string;
  timestamp: string;
  backup_date: string;
  total_projects: number;
  backed_up_projects: number;
  size: number;
  file_count: number;
  files: BackupFileInfo[];
}

export interface BackupFileInfo {
  name: string;
  size: number;
  type: 'main' | 'project' | 'metadata' | 'log' | 'other';
}

export type ViewType = "servers" | "snapshots" | "moduleEditor";
