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

export interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification: { status: string } | null;
}

export interface ClerkUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string;
  username: string | null;
  email_addresses: ClerkEmailAddress[];
  primary_email_address_id: string | null;
  created_at: number; // Unix ms
  updated_at: number; // Unix ms
  last_sign_in_at: number | null; // Unix ms
  public_metadata: Record<string, unknown>;
  banned: boolean;
  locked: boolean;
}

export interface ClerkSession {
  id: string;
  user_id: string;
  status: 'active' | 'ended' | 'expired' | 'revoked' | 'removed';
  created_at: number; // Unix ms
  last_active_at: number; // Unix ms
  expire_at: number; // Unix ms
  ended_at: number | null; // Unix ms
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

export type ViewType = "servers" | "snapshots" | "moduleEditor" | "users";
