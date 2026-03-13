import { createSignal, For } from 'solid-js';
import { addToast } from '../../stores/toastStore.ts';
import {
  createDnsRecordApi,
  createServerApi,
  initNginxApi,
  initSslApi,
  updateServerLabelApi,
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
}

const INITIAL_STEPS: Step[] = [
  { label: 'Creating DNS record', status: 'pending' },
  { label: 'Creating server', status: 'pending' },
  { label: 'Initialising nginx', status: 'pending' },
  { label: 'Initialising SSL', status: 'pending' },
  { label: 'Updating label', status: 'pending' },
];

export function CreateServerModal(props: CreateServerModalProps) {
  const [phase, setPhase] = createSignal<'form' | 'progress'>('form');
  const [serverName, setServerName] = createSignal('');
  const [subdomain, setSubdomain] = createSignal('');
  const [steps, setSteps] = createSignal<Step[]>(INITIAL_STEPS.map(s => ({ ...s })));
  const [finished, setFinished] = createSignal(false);

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

    const name = serverName().trim();
    const sub = subdomain().trim();
    setPhase('progress');

    const token = await props.getToken();

    const ok1 = await runStep(0, () => createDnsRecordApi(sub, token));
    if (!ok1) { setFinished(true); return; }

    const ok2 = await runStep(1, () => createServerApi(sub, token));
    if (!ok2) { setFinished(true); return; }

    const ok3 = await runStep(2, () => initNginxApi(sub, token));
    if (!ok3) { setFinished(true); return; }

    const ok4 = await runStep(3, () => initSslApi(sub, token));
    if (!ok4) { setFinished(true); return; }

    const ok5 = await runStep(4, () => updateServerLabelApi(sub, name, token));
    setFinished(true);
    if (ok5) {
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
                onInput={(e) => setSubdomain(e.currentTarget.value)}
                placeholder="e.g. tim-server"
              />
              <div style="display: flex; gap: 8px; margin-top: 16px">
                <button
                  type="button"
                  class="action-btn"
                  style="flex: 1; background: #444"
                  onClick={() => props.onClose()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="action-btn docker-pull"
                  style="flex: 1"
                  onClick={handleCreate}
                  disabled={!serverName().trim() || !subdomain().trim() || props.sshOperationInProgress()}
                >
                  Create
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