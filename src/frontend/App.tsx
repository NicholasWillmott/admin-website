import { createResource, createSignal, Show, createEffect, onCleanup } from 'solid-js'
import './css/App.css'
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton, useUser, useAuth } from 'clerk-solidjs'
import { ModuleEditorContent } from './components/views/ModuleDefinitions/ModuleEditorContent.tsx';
import { ServersView } from './components/views/Servers/ServersView.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SnapshotsView } from './components/views/SnapshotsView.tsx';
import { VolumeUsageView } from './components/views/VolumeUsageView.tsx';
import { AiUsageView } from './components/views/AiUsageView.tsx';
import { PgStatStatementsView } from './components/views/PgStatStatementsView.tsx';
import { HistoryView } from './components/views/HistoryView.tsx';
import { AccessLogView } from './components/views/AccessLogView.tsx';
import { SiteAdminsView } from './components/views/SiteAdminsView.tsx';
import { DockerPullModal } from './components/modals/DockerPullModal.tsx';
import { ServerVersionsModal } from './components/modals/ServerVersionsModal.tsx';
import { CreateServerModal } from './components/modals/CreateServerModal.tsx';
import { ConfigureCategoriesModal } from './components/modals/CreateCategoryModal.tsx';
import { IndicatorsExportModal } from './components/modals/IndicatorsExportModal.tsx';
import { CurrentlyActiveUsersModal } from './components/modals/CurrentlyActiveUsersModal.tsx';
import { AllServersActivityModal } from './components/modals/AllServersActivityModal.tsx';
import type { ViewType } from './types.ts';
import {
  fetchServerCardData,
  fetchServerStatus,
  fetchAllServerStatuses,
  fetchServerVersions,
  fetchCentralVersions,
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
  fetchAllServerWeeklyUsage,
  fetchAllServerAiLimitHits,
  fetchModelPricing,
  fetchVolumeUsage,
  fetchCategoriesApi,
  fetchVolumesApi,
  sendWeeklySuperAdminReportApi,
  sendInstanceAdminReportsApi,
  fetchChangelogViewApi,
  fetchEmailHistoryApi,
  fetchEmailDetailApi,
  fetchHUsers,
  fetchAllServerUserLogsAggregate,
  fetchAllServerUserLogsAll,
  recordSiteAccess,
  fetchAccessLogs,
  getSiteAdminsApi,
} from './services.ts';
import { ToastContainer } from './components/modals/Toast.tsx';
import { addToast } from './stores/toastStore.ts';
import { Users } from "./components/views/users/Users.tsx";
import { UserLogsView } from "./components/views/UserLogsView.tsx";

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

  // get server versions
  const [serverVersions, { refetch: refetchServerVersions }] = createResource(async () => {
    const token = await getToken();
    return fetchServerVersions(token);
  });

  const [centralVersions, { refetch: refetchCentralVersions }] = createResource(async () => {
    const token = await getToken();
    return fetchCentralVersions(token);
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

  // get internal H users list (kept backend-only to avoid exposing emails in the JS bundle)
  const [hUsers] = createResource(async () => {
    const token = await getToken();
    return fetchHUsers(token);
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

  // track indicators export modal
  const [indicatorsExportModalOpen, setIndicatorsExportModalOpen] = createSignal<boolean>(false);

  // track currently active users modal
  const [activeUsersModalOpen, setActiveUsersModalOpen] = createSignal<boolean>(false);

  // track server activity modal
  const [serverActivityModalOpen, setServerActivityModalOpen] = createSignal<boolean>(false);

  // track which servers I have multi selected
  const [multiSelectMode, setMultiSelectMode] = createSignal(false);
  const [multiSelectedServerIds, setMultiSelectedServerIds] = createSignal<string[] | null>([]);
  const [selectableServerIds, setSelectableServerIds] = createSignal<string[]>([]);


  // track when an ssh operation is happening to stop other ssh operations from occuring
  const [sshOperationInProgress, setSshOperationInProgress] = createSignal<boolean>(false);

  // track locked servers (shared with header's "Select all" button)
  const [lockedServers, setLockedServers] = createSignal<Set<string>>(new Set());
  const [lockedServersResource] = createResource(async () => {
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

  // user logs are needed by the users view and the server activity modal — latched so the
  // fetch fires once on first demand and the data is kept for the rest of the session
  const [userLogsRequested, setUserLogsRequested] = createSignal(false);
  createEffect(() => { if (activeView() === "users") setUserLogsRequested(true); });

  // get user logs for all servers, keyed by server id — lazy: only fetches on first demand
  const [allServerUserLogs] = createResource(
    () => userLogsRequested() && servers() ? servers() : null,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerUserLogs(serverList!, token);
    }
  );

  // get aggregate user logs — lazy: only fetches when userLogs view is active
  const [aggregateLogs] = createResource(
    () => activeView() === "userLogs" && servers() ? servers() : null,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerUserLogsAggregate(serverList!, token);
    }
  );

  // get all raw user logs — lazy: only fetches when userLogs view is active
  const [allRawUserLogs] = createResource(
    () => activeView() === "userLogs" && servers() ? servers() : null,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerUserLogsAll(serverList!, token);
    }
  );

  // get AI usage logs for all servers, keyed by server id — lazy: only fetches when aiUsage view is active
  const [allServerAiUsage, { refetch: refetchAiUsage }] = createResource(
    () => activeView() === "aiUsage" && servers() ? servers() : null,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerAiUsage(serverList!, token);
    }
  );

  // get weekly token usage for all servers — lazy: only fetches when aiUsage view is active
  const [allServerWeeklyUsage, { refetch: refetchWeeklyUsage }] = createResource(
    () => activeView() === "aiUsage" && servers() ? servers() : null,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerWeeklyUsage(serverList!, token);
    }
  );

  // get AI limit hits for all servers — lazy: only fetches when aiUsage view is active
  const [allServerAiLimitHits, { refetch: refetchAiLimitHits }] = createResource(
    () => activeView() === "aiUsage" && servers() ? servers() : null,
    async (serverList) => {
      const token = await getToken();
      return fetchAllServerAiLimitHits(serverList!, token);
    }
  );

  // get LiteLLM model pricing — lazy: only fetches when aiUsage view is active
  const [modelPricing] = createResource(
    () => activeView() === "aiUsage" ? true : null,
    fetchModelPricing
  );

  // get sent email history — lazy: only fetches when changelog view is active
  const [emailHistory, { refetch: refetchEmailHistory }] = createResource(
    () => activeView() === "changelog" ? true : null,
    async () => {
      const token = await getToken();
      return fetchEmailHistoryApi(token);
    }
  );

  // Auto-refresh statuses every 60 seconds
  createEffect(() => {
    const interval = setInterval(() => {
      refetchStatuses();
    }, 60000);
    onCleanup(() => clearInterval(interval));
  });

  const { user: currentUser } = useUser();
  const isAdmin = () => currentUser()?.publicMetadata?.isAdmin === true;
  const SUPER_USER_EMAIL = "nick@usefuldata.com.au";
  const isSuperUser = () =>
    currentUser()?.primaryEmailAddress?.emailAddress?.toLowerCase() === SUPER_USER_EMAIL;

  // Record a site visit once the user is signed in as an admin. The latch keeps
  // it to a single entry per page load (createEffect re-runs as Clerk resolves).
  let accessRecorded = false;
  createEffect(() => {
    if (!accessRecorded && currentUser() && isAdmin()) {
      accessRecorded = true;
      getToken().then(token => recordSiteAccess(token));
    }
  });

  // Access log entries — lazy: only fetches when the super user opens the tab.
  const [accessLogs, { refetch: refetchAccessLogs }] = createResource(
    () => activeView() === "accessLog" && isSuperUser() ? true : null,
    async () => {
      const token = await getToken();
      return fetchAccessLogs(token);
    }
  );

  // Site admins (people with access to this dashboard) — lazy: only fetches when the tab is opened.
  const [siteAdmins, { refetch: refetchSiteAdmins }] = createResource(
    () => activeView() === "siteAdmins" ? true : null,
    async () => {
      const token = await getToken();
      return getSiteAdminsApi(token);
    }
  );

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
  const createVolumeSnapshot = async (volume: string, name: string) => {
    setSnappingVolume(true);
    try {
      const token = await getToken();
      const result = await createVolumeSnapshotApi(volume, name, token);
      if (result.success) {
        addToast(`Volume snapshot created successfully!`, "success");
        refetchSnapshots();
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
  const handleDockerPull = async (version: string, type: 'server' | 'central') => {
    if (sshOperationInProgress()) {
      addToast('Please wait for the current operation to complete', "info");
      return;
    }
    setSshOperationInProgress(true);
    try {
      const token = await getToken();
      await dockerPull(version, token, type);
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (type === 'central') {
        await refetchCentralVersions();
      } else {
        await refetchServerVersions();
      }
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
              <div class="nav-right">
                <Show when={activeView() === "servers"}>
                  <button
                    type="button"
                    class={`multi-select-toggle ${multiSelectMode() ? 'active' : ''}`}
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
                      class="multi-select-toggle active"
                      disabled={lockedServersResource.loading}
                      onClick={() => {
                        const selectable = selectableServerIds().filter(id => !lockedServers().has(id));
                        setMultiSelectedServerIds(selectable.filter(id => {
                          const s = (servers() ?? []).find(s => s.id === id);
                          return s?.mode !== 'central';
                        }));
                      }}
                    >
                      {lockedServersResource.loading ? 'Loading...' : 'Select all'}
                    </button>
                  </Show>
                  <button
                    type="button"
                    onClick={() => setCreateCategoryModalOpen(true)}
                  >
                    Configure Categories
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateServerModalOpen(true)}
                  >
                    Create Server
                  </button>
                </Show>
                {/* Add toolbar buttons for other views here using <Show when={activeView() === "viewName"}> */}
              </div>
            </div>
          </Show>
        </SignedIn>
      </div>

      <SignedIn>
        <Show when={isAdmin()}>
          <Sidebar
            activeView={activeView}
            onSelect={setActiveView}
            isSuperUser={isSuperUser}
            actions={[
              { label: 'Docker Pull', iconPath: 'M12 4v10m0 0l-4-4m4 4l4-4M5 19h14', onClick: () => setDockerPullModalOpen(true) },
              { label: 'Server Versions', iconPath: 'M4 4h6l10 10-6 6L4 10V4zM8 8h.01', onClick: () => setServerVersionsModalOpen(true) },
              { label: 'Export Indicators', iconPath: 'M12 15V3m0 0L8 7m4-4l4 4M4 15v4h16v-4', onClick: () => setIndicatorsExportModalOpen(true) },
              { label: 'Active Users', iconPath: 'M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 8v6M23 11h-6', onClick: () => { setUserLogsRequested(true); setActiveUsersModalOpen(true); } },
              { label: 'Server Activity', iconPath: 'M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01', onClick: () => setServerActivityModalOpen(true) },
            ]}
          />
        </Show>
      </SignedIn>

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
              userLogsLoading={() => allServerUserLogs.loading}
              onRequestUserLogs={() => setUserLogsRequested(true)}
              serverVersions={serverVersions}
              centralVersions={centralVersions}
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
              volumes={volumes() ?? []}
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
              weeklyUsage={allServerWeeklyUsage()}
              limitHits={allServerAiLimitHits()}
              pricing={modelPricing()}
              loading={allServerAiUsage.loading || modelPricing.loading}
              error={allServerAiUsage.error}
              onRefetch={() => { refetchAiUsage(); refetchWeeklyUsage(); refetchAiLimitHits(); }}
            />
          </Show>

          <Show when={activeView() === "pgStatements"}>
            <PgStatStatementsView
              servers={servers()}
              getToken={getToken}
            />
          </Show>

          <Show when={activeView() === "moduleEditor"}>
            <ModuleEditorContent/>
          </Show>

          <Show when={activeView() === "userLogs"}>
            <UserLogsView
              servers={servers()}
              aggregateLogs={aggregateLogs()}
              aggregateLoading={aggregateLogs.loading}
              rawLogs={allRawUserLogs()}
              rawLoading={allRawUserLogs.loading}
            />
          </Show>

          <Show when={activeView() === "accessLog" && isSuperUser()}>
            <AccessLogView
              entries={accessLogs()}
              loading={accessLogs.loading}
              error={accessLogs.error}
              onRefetch={refetchAccessLogs}
            />
          </Show>

          <Show when={activeView() === "changelog"}>
            <HistoryView
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
              hUsers={hUsers() ?? []}
              getToken={getToken}
              onFetchInstanceStatus={async (serverId) => {
                const token = await getToken();
                return fetchServerStatus(serverId, token);
              }}
            />
          </Show>

          <Show when={activeView() === "siteAdmins"}>
            <SiteAdminsView
              data={siteAdmins()}
              loading={siteAdmins.loading}
              onRefetch={refetchSiteAdmins}
              allUsers={clerkUsers()}
              isSuperUser={isSuperUser}
              superUserEmail={SUPER_USER_EMAIL}
              getToken={getToken}
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

        {/* Indicators Export Modal */}
        {indicatorsExportModalOpen() && (
          <IndicatorsExportModal
            servers={servers() || []}
            getToken={getToken}
            onClose={() => setIndicatorsExportModalOpen(false)}
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

        {/* Currently Active Users Modal */}
        {activeUsersModalOpen() && (
          <CurrentlyActiveUsersModal
            users={clerkUsers()}
            servers={servers()}
            statuses={statuses()}
            userLogs={allServerUserLogs()}
            onClose={() => setActiveUsersModalOpen(false)}
          />
        )}

        {/* Server Activity Modal */}
        {serverActivityModalOpen() && (
          <AllServersActivityModal
            servers={servers()}
            statuses={statuses()}
            onClose={() => setServerActivityModalOpen(false)}
          />
        )}
      </SignedIn>
    </>
  )
}

export default App
