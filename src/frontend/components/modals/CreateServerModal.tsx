import { createSignal, For, Show } from 'solid-js';
import { addToast } from '../../stores/toastStore.ts';
import {
  createDnsRecordApi,
  createServerApi,
  initDirsApi,
  initNginxApi,
  initSslApi,
  updateServerLabelApi,
  updateServerLanguageApi,
  updateServerCalendarApi,
  updateServerOpenAccessApi,
  runServerApi,
  assignServerCategoryApi,
  checkServerConflictsApi,
  type ServerCategory,
  type ServerConflicts,
} from '../../services.ts';

type StepStatus = 'pending' | 'loading' | 'done' | 'error';

interface Step {
  label: string;
  status: StepStatus;
  error?: string;
}

interface CreateServerModalProps {
  sshOperationInProgress: () => boolean;
  setSshOperationInProgress: (v: boolean) => void;
  onClose: () => void;
  onCreated: () => void;
  getToken: () => Promise<string | null>;
  categories: () => ServerCategory[];
}

const INITIAL_STEPS: Step[] = [
  { label: 'Creating DNS record', status: 'pending' },
  { label: 'Creating server', status: 'pending' },
  { label: 'Initialising directories', status: 'pending' },
  { label: 'Initialising nginx', status: 'pending' },
  { label: 'Initialising SSL', status: 'pending' },
  { label: 'Updating label', status: 'pending' },
  { label: 'Setting config', status: 'pending' },
  { label: 'Running server', status: 'pending' },
];

const CONFLICT_LABELS: Record<keyof ServerConflicts, string> = {
  dns: 'DNS record already exists',
  config: 'Server already exists in wb config',
  nginx: 'Nginx config already exists',
  ssl: 'SSL certificate already exists',
  serversJson: 'Server already exists in servers.json',
};

export function CreateServerModal(props: CreateServerModalProps) {
  const [phase, setPhase] = createSignal<'form' | 'progress'>('form');
  const [serverName, setServerName] = createSignal('');
  const [subdomain, setSubdomain] = createSignal('');
  const [category, setCategory] = createSignal('');
  const [french, setFrench] = createSignal(false);
  const [ethiopian, setEthiopian] = createSignal(false);
  const [openAccess, setOpenAccess] = createSignal(false);
  const [steps, setSteps] = createSignal<Step[]>(INITIAL_STEPS.map(s => ({ ...s })));
  const [finished, setFinished] = createSignal(false);

  const [checking, setChecking] = createSignal(false);
  const [conflicts, setConflicts] = createSignal<ServerConflicts | null>(null);
  const [checkedFor, setCheckedFor] = createSignal('');

  const subdomainError = () => {
    const sub = subdomain().trim();
    if (!sub) return null;
    if (sub.length > 63) return 'Subdomain must be 63 characters or fewer';
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(sub)) return 'Only lowercase letters, numbers, and hyphens allowed. Cannot start or end with a hyphen';
    return null;
  };

  const hasConflicts = () => {
    const c = conflicts();
    return c !== null && Object.values(c).some(Boolean);
  };

  const handleSubdomainInput = (val: string) => {
    setSubdomain(val);
    if (val.trim() !== checkedFor()) {
      setConflicts(null);
    }
  };

  const runChecks = async (sub: string) => {
    if (!sub || subdomainError()) return;
    setChecking(true);
    const token = await props.getToken();
    const result = await checkServerConflictsApi(sub, token);
    setConflicts(result);
    setCheckedFor(sub);
    setChecking(false);
  };

  const updateStep = (index: number, patch: Partial<Step>) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
  };

  const runStep = async (index: number, fn: () => Promise<{ success: boolean; error?: string }>) => {
    updateStep(index, { status: 'loading' });
    props.setSshOperationInProgress(true);
    try {
      const result = await fn();
      if (!result.success) {
        updateStep(index, { status: 'error', error: result.error || 'Unknown error' });
        return false;
      }
      updateStep(index, { status: 'done' });
      return true;
    } catch (e) {
      updateStep(index, { status: 'error', error: String(e) });
      return false;
    } finally {
      props.setSshOperationInProgress(false);
    }
  };

  const handleCreate = async () => {
    if (props.sshOperationInProgress()) {
      addToast('Another SSH operation is in progress. Please wait.', 'info');
      return;
    }

    const sub = subdomain().trim();

    // Run checks if not yet done for the current subdomain
    if (checkedFor() !== sub) {
      await runChecks(sub);
    }
    if (hasConflicts()) return;

    const name = serverName().trim();
    setPhase('progress');

    const token = await props.getToken();

    const ok1 = await runStep(0, () => createDnsRecordApi(sub, token));
    if (!ok1) { setFinished(true); return; }

    const ok2 = await runStep(1, () => createServerApi(sub, token));
    if (!ok2) { setFinished(true); return; }

    const ok3 = await runStep(2, () => initDirsApi(sub, token));
    if (!ok3) { setFinished(true); return; }

    const ok4 = await runStep(3, () => initNginxApi(sub, token));
    if (!ok4) { setFinished(true); return; }

    const ok5 = await runStep(4, () => initSslApi(sub, token));
    if (!ok5) { setFinished(true); return; }

    const ok6 = await runStep(5, () => updateServerLabelApi(sub, name, token));
    if (!ok6) { setFinished(true); return; }

    const ok7 = await runStep(6, async () => {
      if (french()) {
        const r = await updateServerLanguageApi(sub, true, token);
        if (!r.success) return r;
      }
      if (ethiopian()) {
        const r = await updateServerCalendarApi(sub, true, token);
        if (!r.success) return r;
      }
      if (openAccess()) {
        const r = await updateServerOpenAccessApi(sub, true, token);
        if (!r.success) return r;
      }
      if (category()) {
        const r = await assignServerCategoryApi(sub, category(), token);
        if (!r.success) return r;
      }
      return { success: true };
    });
    if (!ok7) { setFinished(true); return; }

    const ok8 = await runStep(7, () => runServerApi(sub, token));
    setFinished(true);
    if (ok8) {
      addToast(`Server ${sub} created successfully`, 'success');
      props.onCreated();
    }
  };

  const statusIcon = (status: StepStatus) => {
    if (status === 'pending') return <span class="create-server-step-icon pending">·</span>;
    if (status === 'loading') return <span class="create-server-step-icon loading"><span class="create-server-spinner" /></span>;
    if (status === 'done') return <span class="create-server-step-icon done">✓</span>;
    return <span class="create-server-step-icon error">✗</span>;
  };

  const isCreateDisabled = () =>
    !serverName().trim() ||
    !subdomain().trim() ||
    !!subdomainError() ||
    checking() ||
    hasConflicts() ||
    props.sshOperationInProgress();

  return (
    <div class="modal-overlay" onClick={() => { if (phase() === 'form') props.onClose(); }}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 480px">
        <div class="modal-header">
          <h2>{phase() === 'form' ? 'Create Server' : 'Creating Server'}</h2>
          {phase() === 'form' && (
            <button class="modal-close" onClick={() => props.onClose()}>✕</button>
          )}
        </div>
        <div class="modal-body">
          {phase() === 'form' ? (
            <div class="docker-pull-form">
              <label for="cs-server-name">Server Name</label>
              <input
                id="cs-server-name"
                type="text"
                class="version-input"
                value={serverName()}
                onInput={(e) => setServerName(e.currentTarget.value)}
                placeholder="Country name"
                autofocus
              />
              <label for="cs-subdomain" style="margin-top: 12px">Subdomain</label>
              <input
                id="cs-subdomain"
                type="text"
                class="version-input"
                value={subdomain()}
                onInput={(e) => handleSubdomainInput(e.currentTarget.value)}
                onBlur={() => runChecks(subdomain().trim())}
                placeholder="e.g. tim-server"
              />
              {subdomainError() && (
                <p style="color: #dc3545; font-size: 12px; margin: 4px 0 0">{subdomainError()}</p>
              )}
              <Show when={checking()}>
                <p style="color: #aaa; font-size: 12px; margin: 4px 0 0">Checking availability…</p>
              </Show>
              <Show when={!checking() && hasConflicts()}>
                <For each={Object.entries(conflicts()!) as [keyof ServerConflicts, boolean][]}>
                  {([key, exists]) => (
                    <Show when={exists}>
                      <p style="color: #dc3545; font-size: 12px; margin: 4px 0 0">✗ {CONFLICT_LABELS[key]}</p>
                    </Show>
                  )}
                </For>
              </Show>
              <Show when={!checking() && conflicts() !== null && !hasConflicts()}>
                <p style="color: #28a745; font-size: 12px; margin: 4px 0 0">✓ No conflicts found</p>
              </Show>

              <label for="cs-category" style="margin-top: 12px">Category</label>
              <select
                id="cs-category"
                class="version-input"
                value={category()}
                onChange={(e) => setCategory(e.currentTarget.value)}
              >
                <option value="">None (Misc)</option>
                <For each={props.categories()}>
                  {(cat) => <option value={cat.name}>{cat.name}</option>}
                </For>
              </select>

              <div class="config-rows" style="margin-top: 16px">
                <div class="config-row">
                  <span class="config-label">Language</span>
                  <div class="config-toggle-group">
                    <button type="button" class={`config-toggle-btn ${!french() ? 'active' : ''}`} onClick={() => setFrench(false)}>English</button>
                    <button type="button" class={`config-toggle-btn ${french() ? 'active' : ''}`} onClick={() => setFrench(true)}>French</button>
                  </div>
                </div>
                <div class="config-row">
                  <span class="config-label">Calendar</span>
                  <div class="config-toggle-group">
                    <button type="button" class={`config-toggle-btn ${!ethiopian() ? 'active' : ''}`} onClick={() => setEthiopian(false)}>Gregorian</button>
                    <button type="button" class={`config-toggle-btn ${ethiopian() ? 'active' : ''}`} onClick={() => setEthiopian(true)}>Ethiopian</button>
                  </div>
                </div>
                <div class="config-row">
                  <span class="config-label">Open Access</span>
                  <div class="config-toggle-group">
                    <button type="button" class={`config-toggle-btn ${!openAccess() ? 'active' : ''}`} onClick={() => setOpenAccess(false)}>Off</button>
                    <button type="button" class={`config-toggle-btn ${openAccess() ? 'active' : ''}`} onClick={() => setOpenAccess(true)}>On</button>
                  </div>
                </div>
              </div>

              <div style="display: flex; gap: 8px; margin-top: 16px">
                <button
                  type="button"
                  class="action-btn"
                  style="flex: 1; background: #444; color: #fff"
                  onClick={() => props.onClose()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="action-btn docker-pull"
                  style="flex: 1"
                  onClick={handleCreate}
                  disabled={isCreateDisabled()}
                >
                  {checking() ? 'Checking…' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <div class="create-server-steps">
              <For each={steps()}>
                {(step) => (
                  <div class="create-server-step">
                    <div class="create-server-step-row">
                      {statusIcon(step.status)}
                      <span class={`create-server-step-label ${step.status}`}>{step.label}</span>
                    </div>
                    {step.error && (
                      <div class="create-server-step-error">{step.error}</div>
                    )}
                  </div>
                )}
              </For>
              {finished() && (
                <button
                  type="button"
                  class="action-btn docker-pull"
                  style="margin-top: 20px; width: 100%"
                  onClick={() => props.onClose()}
                >
                  Close
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
