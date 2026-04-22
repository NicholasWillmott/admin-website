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
  volume?: string;
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
  unsafe_metadata: Record<string, unknown>;
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
  serverUsers?: string[];
  projects: string[];
  hasRunningModules: boolean;
  lastUserLog: { userEmail: string; endpoint: string; timestamp: string } | null;
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

export interface UserLog {
  user_email: string;
  endpoint: string;
  timestamp: string;
}

export type ServerUserLogs = { [serverId: string]: UserLog[] };

export interface VolumeDfStats {
  filesystem: string;
  totalGB: number;
  usedGB: number;
  availableGB: number;
  usePercent: number;
  mountedOn: string;
}

export interface VolumeDirEntry {
  name: string;
  sizeGB: number;
}

export interface VolumeUsage {
  volumeName: string;
  mountPath: string;
  df: VolumeDfStats;
  directories: VolumeDirEntry[];
}

export interface AiUsageLog {
  id: number;
  timestamp: string;
  user_email: string;
  project_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type ServerAiUsageLogs = { [serverId: string]: AiUsageLog[] };

export interface ModelPricing {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
}

export interface ChangelogItem {
  desc: string;
  audience: string;
}

export interface ChangelogTypeGroup {
  type: string;
  items: ChangelogItem[];
}

export interface ChangelogVersion {
  version: string;
  types: ChangelogTypeGroup[];
}

export type ViewType = "servers" | "snapshots" | "moduleEditor" | "users" | "volumeUsage" | "aiUsage" | "changelog";

export interface SentEmailSummary {
  id: string;
  type: "superadmin" | "instance-admin";
  sentAt: number;
  subject: string;
  recipients: string[];
  instanceLabel?: string;
  instanceId?: string;
}
