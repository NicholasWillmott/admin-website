import { createResource, createSignal, Show, createEffect, onCleanup } from 'solid-js'
import './css/App.css'
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser, useAuth } from 'clerk-solidjs'
import { ModuleEditorContent } from './components/views/ModuleDefinitions/ModuleEditorContent.tsx';
import { ServersView } from './components/views/Servers/ServersView.tsx';
import { SnapshotsView } from './components/views/SnapshotsView.tsx';
import { VolumeUsageView } from './components/views/VolumeUsageView.tsx';
import { AiUsageView } from './components/views/AiUsageView.tsx';
import { ChangelogView } from './components/views/ChangelogView.tsx';
import { DockerPullModal } from './components/modals/DockerPullModal.tsx';
import { ServerVersionsModal } from './components/modals/ServerVersionsModal.tsx';
import { CreateServerModal } from './components/modals/CreateServerModal.tsx';
import { ConfigureCategoriesModal } from './components/modals/CreateCategoryModal.tsx';
import type { ViewType } from './types.ts';
import {
  fetchServerCardData,
  fetchServerStatus,
  fetchAllServerStatuses,
  fetchServerVersions,
  fetchVolumeSnapshots,
  dockerPull,
  deleteVolumeSnapshotApi,
  createVolumeSnapshotApi,
  getUsersApi,
  getUserSessionsApi,
  fetchLockedServersApi,
  lockServerApi,
  unlockServerApi,
  fetchAllServerUserLogs,
  fetchAllServerAiUsage,
  fetchModelPricing,
  fetchVolumeUsage,
  fetchCategoriesApi,
  fetchVolumesApi,
  sendWeeklySuperAdminReportApi,
  sendInstanceAdminReportsApi,
  fetchChangelogViewApi,
  fetchEmailHistoryApi,
  fetchEmailDetailApi,
} from './services.ts';
import { ToastContainer } from './components/modals/Toast.tsx';
import { addToast } from './stores/toastStore.ts';
import { Users } from "./components/views/users/Users.tsx";

function App() {
  const { getToken } = useAuth();

  // get server data
  const [servers, { mutate, refetch: refetchServers }] = createResource(fetchServerCardData)

  // get server categories
  const [categories, { refetch: refetchDynamicCategories }] = createResource(async () => {
    const token = await getToken();
    return fetchCategoriesApi(token);
  });

  // get available volumes
  const [volumes] = createResource(async () => {
    const token = await getToken();
    return fetchVolumesApi(token);
  });

  // get server status, total users, uptime, etc
  const [statuses, { refetch: refetchStatuses }] = createResource(
    servers,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerStatuses(serverList, token);
    }
  );

  // get user logs for all servers (fetched once on load), keyed by server id
  const [allServerUserLogs] = createResource(
    servers,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerUserLogs(serverList, token);
    }
  );

  // get AI usage logs for all servers, keyed by server id
  const [allServerAiUsage, { refetch: refetchAiUsage }] = createResource(
    servers,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerAiUsage(serverList, token);
    }
  );

  // get LiteLLM model pricing
  const [modelPricing] = createResource(fetchModelPricing);

  // get server versions
  const [serverVersions, { refetch: refetchServerVersions }] = createResource(async () => {
    const token = await getToken();
    return fetchServerVersions(token);
  });

  // fetch volume usage for all unique volumes across servers
  const [volumeUsages, { refetch: refetchVolumeUsages }] = createResource(
    servers,
    async (serverList) => {
      const token = await getToken();
      const uniqueVolumes = [...new Set(serverList.flatMap(s => s.volume ? [s.volume] : []))];
      const entries = await Promise.all(
        uniqueVolumes.map(async (v) => [v, await fetchVolumeUsage(v, token)] as const)
      );
      return Object.fromEntries(entries) as Record<string, import('./types.ts').VolumeUsage | null>;
    }
  );

  // track loading volume snapshots
  const [volumeSnapshots, { refetch: refetchSnapshots }] = createResource(async () => {
    const token = await getToken();
    return fetchVolumeSnapshots(token);
  });

  // get all users
  const [clerkUsers] = createResource(async () => {
    const token = await getToken();
    return getUsersApi(token);
  });

  // get changelog
  const [changelog] = createResource(async () => {
    const token = await getToken();
    return fetchChangelogViewApi(token);
  });

  // get sent email history
  const [emailHistory, { refetch: refetchEmailHistory }] = createResource(async () => {
    const token = await getToken();
    return fetchEmailHistoryApi(token);
  });

  const handleViewEmail = async (id: string, key: string): Promise<string | null> => {
    const token = await getToken();
    const record = await fetchEmailDetailApi(token, id, key);
    return record?.html ?? null;
  };

  // track setting snapshot
  const [snappingVolume, setSnappingVolume] = createSignal<boolean>(false);

  // track docker pull modal
  const [dockerPullModalOpen, setDockerPullModalOpen] = createSignal<boolean>(false);

  // track server versions modal
  const [serverVersionsModalOpen, setServerVersionsModalOpen] = createSignal<boolean>(false);

  // track create server modal
  const [createServerModalOpen, setCreateServerModalOpen] = createSignal<boolean>(false);

  // track create category modal
  const [createCategoryModalOpen, setCreateCategoryModalOpen] = createSignal<boolean>(false);

  // track which servers I have multi selected
  const [multiSelectMode, setMultiSelectMode] = createSignal(false);
  const [multiSelectedServerIds, setMultiSelectedServerIds] = createSignal<string[] | null>([]);
  const [selectableServerIds, setSelectableServerIds] = createSignal<string[]>([]);

  // track when an ssh operation is happening to stop other ssh operations from occuring
  const [sshOperationInProgress, setSshOperationInProgress] = createSignal<boolean>(false);

  // track locked servers (shared with header's "Select all" button)
  const [lockedServers, setLockedServers] = createSignal<Set<string>>(new Set());
  createResource(async () => {
    const token = await getToken();
    const locks = await fetchLockedServersApi(token) as string[];
    setLockedServers(new Set(locks));
  });
  const toggleLock = async (serverId: string) => {
    const isLocked = lockedServers().has(serverId);
    setLockedServers(prev => {
      const next = new Set(prev);
      isLocked ? next.delete(serverId) : next.add(serverId);
      return next;
    });
    const token = await getToken();
    isLocked ? await unlockServerApi(serverId, token) : await lockServerApi(serverId, token);
  };

  // Track active view
  const [activeView, setActiveView] = createSignal<ViewType>("servers");

  // Auto-refresh statuses every 60 seconds
  createEffect(() => {
    const interval = setInterval(() => {
      refetchStatuses();
    }, 60000);
    onCleanup(() => clearInterval(interval));
  });

  const { user: currentUser } = useUser();
  const isAdmin = () => currentUser()?.publicMetadata?.isAdmin === true;

  // delete snapshot of volume
  const deleteVolumeSnapshot = async (snapshotId: string) => {
    if (!confirm('Are you sure you want to delete this snapshot? This action cannot be undone.')) {
      return;
    }
    try {
      const token = await getToken();
      const result = await deleteVolumeSnapshotApi(snapshotId, token);
      if (result.success) {
        addToast('Snapshot deleted successfully!', "success");
        refetchSnapshots();
      } else {
        addToast(`Failed to delete snapshot: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Error deleting snapshot: ${error}`, "error");
    }
  };

  // create snapshot of volume
  const createVolumeSnapshot = async () => {
    setSnappingVolume(true);
    try {
      const token = await getToken();
      const result = await createVolumeSnapshotApi(token);
      if (result.success) {
        addToast(`Volume snapshot created successfully!`, "success");
      } else {
        addToast(`Failed to create snapshot: ${result.error}`, "error");
      }
    } catch (error) {
      addToast(`Error creating snapshot: ${error}`, "error");
    } finally {
      setSnappingVolume(false);
    }
  };

  // fetch sessions for a user
  const handleFetchSessions = async (userId: string, since?: number) => {
    const token = await getToken();
    return getUserSessionsApi(userId, token, since);
  };

  const handleSendWeeklyReport = async (emails: string[]) => {
    const token = await getToken();
    const result = await sendWeeklySuperAdminReportApi(token, emails);
    if (result.success) {
      addToast(`Weekly report sent to ${result.sentTo} admin(s)`, 'success');
    } else {
      addToast(`Failed to send report: ${result.error}`, 'error');
    }
  };

  const handleSendInstanceAdminReports = async (serverIds: string[]) => {
    const token = await getToken();
    const result = await sendInstanceAdminReportsApi(token, serverIds);
    if (result.success) {
      addToast(`Instance admin reports sent (${result.emailsSent} email(s))`, 'success');
    } else {
      addToast(`Failed to send instance admin reports: ${result.error}`, 'error');
    }
  };

  const handleFetchActivity = async (email: string, serverId: string | null): Promise<string[]> => {
    const logs = allServerUserLogs();
    if (!logs) return [];
    const serverIds = serverId ? [serverId] : Object.keys(logs);
    const activeDays = new Set<string>();
    for (const id of serverIds) {
      for (const log of logs[id] ?? []) {
        if (log.user_email === email && log.endpoint === 'getCurrentUser') activeDays.add(log.timestamp.slice(0, 10));
      }
    }
    return [...activeDays].sort();
  };

  // docker pull handler
  const handleDockerPull = async (version: string) => {
    if (sshOperationInProgress()) {
      addToast('Please wait for the current operation to complete', "info");
      return;
    }
    setSshOperationInProgress(true);
    try {
      const token = await getToken();
      await dockerPull(version, token);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await refetchServerVersions();
    } finally {
      setSshOperationInProgress(false);
    }
  };

  return (
    <>
      <ToastContainer />
      <div class="sticky-header">
        <h1>STATUS</h1>
        <SignedIn>
          <Show when={isAdmin()}>
            <div class="button-container">
              <div class="nav-left">
                {activeView() === "servers" && (
                  <div>
                    <button
                      type="button"
                      class={`multi-select-toggle ${multiSelectMode() ? 'active' : ''}`}
                      style="margin-left: 8px"
                      onClick={() => {
                        if (multiSelectMode()) setMultiSelectedServerIds([]);
                        setMultiSelectMode(m => !m);
                      }}
                    >
                      {multiSelectMode() ? `Cancel (${multiSelectedServerIds()!.length} selected)` : 'Select Servers'}
                    </button>
                    <Show when={multiSelectMode()}>
                      <button
                        type="button"
                        class={`multi-select-toggle ${multiSelectMode() ? 'active' : ''}`}
                        style="margin-left: 8px"
                        onClick={() => setMultiSelectedServerIds(selectableServerIds())}
                      >
                        Select all
                      </button>
                    </Show>
                    <button
                      type="button"
                      style="margin-left: 8px"
                      onClick={() => setCreateCategoryModalOpen(true)}
                    >
                      Configure Categories
                    </button>
                    <button
                      type="button"
                      style="margin-left: 8px"
                      onClick={() => setCreateServerModalOpen(true)}
                    >
                      Create Server
                    </button>
                  </div>
                )}
              </div>
              <div class="nav-buttons">
                <button
                  type="button"
                  data-selected={activeView() === "servers"}
                  onClick={() => setActiveView("servers")}
                >
                  Servers
                </button>
                <button
                  type="button"
                  data-selected={activeView() === "snapshots"}
                  onClick={() => setActiveView("snapshots")}
                >
                  Snapshots
                </button>
                <button
                  type="button"
                  data-selected={activeView() === "users"}
                  onClick={() => setActiveView("users")}
                >
                  Users
                </button>
                <button
                  type="button"
                  data-selected={activeView() === "volumeUsage"}
                  onClick={() => setActiveView("volumeUsage")}
                >
                  Volume Usage
                </button>
                <button
                  type="button"
                  data-selected={activeView() === "aiUsage"}
                  onClick={() => setActiveView("aiUsage")}
                >
                  AI Usage
                </button>
                <button
                  type="button"
                  data-selected={activeView() === "moduleEditor"}
                  onClick={() => setActiveView("moduleEditor")}
                >
                  Module Definitions
                </button>
                <button
                  type="button"
                  data-selected={activeView() === "changelog"}
                  onClick={() => setActiveView("changelog")}
                >
                  History
                </button>
                <button
                  type="button"
                  onClick={() => setDockerPullModalOpen(true)}
                >
                  Docker Pull
                </button>
                <button
                  type="button"
                  onClick={() => setServerVersionsModalOpen(true)}
                >
                  Server Versions
                </button>
              </div>
              <div class="nav-right" />
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
          <Show when={!categories.loading}>
            <UserButton />
          </Show>
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
            <ServersView
              servers={servers}
              serversLoading={servers.loading}
              serversError={servers.error}
              mutate={mutate}
              refetchServers={refetchServers}
              categories={categories}
              categoriesLoading={categories.loading}
              refetchDynamicCategories={refetchDynamicCategories}
              statuses={statuses}
              statusesLoading={statuses.loading}
              refetchStatuses={refetchStatuses}
              allServerUserLogs={allServerUserLogs}
              serverVersions={serverVersions}
              volumes={volumes}
              lockedServers={lockedServers}
              onToggleLock={toggleLock}
              sshOperationInProgress={sshOperationInProgress}
              setSshOperationInProgress={setSshOperationInProgress}
              multiSelectMode={multiSelectMode}
              multiSelectedServerIds={multiSelectedServerIds}
              setMultiSelectedServerIds={setMultiSelectedServerIds}
              setSelectableServerIds={setSelectableServerIds}
              getToken={getToken}
            />
          </Show>

          <Show when={activeView() === "snapshots"}>
            <SnapshotsView
              snapshots={volumeSnapshots()}
              loading={volumeSnapshots.loading}
              error={volumeSnapshots.error}
              snappingVolume={snappingVolume()}
              onCreateSnapshot={createVolumeSnapshot}
              onDeleteSnapshot={deleteVolumeSnapshot}
            />
          </Show>

          <Show when={activeView() === "volumeUsage"}>
            <VolumeUsageView
              servers={servers()}
              volumeUsages={volumeUsages() ?? {}}
              loading={volumeUsages.loading}
              error={volumeUsages.error}
              onRefetch={refetchVolumeUsages}
            />
          </Show>

          <Show when={activeView() === "aiUsage"}>
            <AiUsageView
              servers={servers()}
              aiUsageLogs={allServerAiUsage()}
              pricing={modelPricing()}
              loading={allServerAiUsage.loading || modelPricing.loading}
              error={allServerAiUsage.error}
              onRefetch={refetchAiUsage}
            />
          </Show>

          <Show when={activeView() === "moduleEditor"}>
            <ModuleEditorContent/>
          </Show>

          <Show when={activeView() === "changelog"}>
            <ChangelogView
              changelog={changelog()}
              loading={changelog.loading}
              error={changelog.error}
              emailHistory={emailHistory()}
              emailHistoryLoading={emailHistory.loading}
              onRefetchEmails={refetchEmailHistory}
              onViewEmail={handleViewEmail}
            />
          </Show>

          <Show when={activeView() === "users"}>
            <Users
              users={clerkUsers()}
              loading={clerkUsers.loading}
              error={clerkUsers.error}
              onFetchSessions={handleFetchSessions}
              onFetchActivity={handleFetchActivity}
              onSendWeeklyReport={handleSendWeeklyReport}
              onSendInstanceAdminReports={handleSendInstanceAdminReports}
              servers={servers()}
              userLogs={allServerUserLogs()}
              onFetchInstanceStatus={async (serverId) => {
                const token = await getToken();
                return fetchServerStatus(serverId, token);
              }}
            />
          </Show>

        </Show>

        {/* Server Versions Modal */}
        {serverVersionsModalOpen() && (
          <ServerVersionsModal
            servers={servers}
            onClose={() => setServerVersionsModalOpen(false)}
          />
        )}

        {/* Docker Pull Modal */}
        {dockerPullModalOpen() && (
          <DockerPullModal
            sshOperationInProgress={sshOperationInProgress()}
            onClose={() => setDockerPullModalOpen(false)}
            onPull={handleDockerPull}
          />
        )}

        {/* Create Server Modal */}
        {createServerModalOpen() && (
          <CreateServerModal
            sshOperationInProgress={sshOperationInProgress}
            setSshOperationInProgress={setSshOperationInProgress}
            onClose={() => setCreateServerModalOpen(false)}
            onCreated={() => { setCreateServerModalOpen(false); refetchServers(); refetchDynamicCategories(); }}
            getToken={getToken}
            categories={() => categories() || []}
            volumes={() => volumes() || []}
          />
        )}

        {/* Configure Categories Modal */}
        {createCategoryModalOpen() && (
          <ConfigureCategoriesModal
            onClose={() => setCreateCategoryModalOpen(false)}
            onUpdated={() => refetchDynamicCategories()}
            getToken={getToken}
            categories={categories() || []}
          />
        )}
      </SignedIn>
    </>
  )
}

export default App
