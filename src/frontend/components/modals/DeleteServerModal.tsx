import { createSignal, For } from 'solid-js';
import { addToast } from '../../stores/toastStore.ts';
import {
  stopServerApi,
  removeSslApi,
  removeNginxApi,
  removeServerApi,
  deleteDnsRecordApi,
} from '../../services.ts';

type StepStatus = 'pending' | 'loading' | 'done' | 'error';

interface Step {
  label: string;
  status: StepStatus;
  error?: string;
}

interface DeleteServerModalProps {
  serverId: string;
  onClose: () => void;
  onDeleted: () => void;
  getToken: () => Promise<string | null>;
}

const INITIAL_STEPS: Step[] = [
  { label: 'Stopping server', status: 'pending' },
  { label: 'Removing SSL', status: 'pending' },
  { label: 'Removing nginx', status: 'pending' },
  { label: 'Removing server config', status: 'pending' },
  { label: 'Deleting DNS record', status: 'pending' },
];

export function DeleteServerModal(props: DeleteServerModalProps) {
  const [phase, setPhase] = createSignal<'input' | 'confirm' | 'progress'>('input');
  const [inputValue, setInputValue] = createSignal('');
  const [steps, setSteps] = createSignal<Step[]>(INITIAL_STEPS.map(s => ({ ...s })));
  const [finished, setFinished] = createSignal(false);

  const expectedText = `I want to delete ${props.serverId}`;

  const updateStep = (index: number, patch: Partial<Step>) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
  };

  const runStep = async (index: number, fn: () => Promise<{ success: boolean; error?: string }>) => {
    updateStep(index, { status: 'loading' });
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
    }
  };

  const handleDelete = async () => {
    setPhase('progress');
    const token = await props.getToken();
    const id = props.serverId;

    const ok1 = await runStep(0, () => stopServerApi(id, token));
    if (!ok1) { setFinished(true); return; }

    const ok2 = await runStep(1, () => removeSslApi(id, token));
    if (!ok2) { setFinished(true); return; }

    const ok3 = await runStep(2, () => removeNginxApi(id, token));
    if (!ok3) { setFinished(true); return; }

    const ok4 = await runStep(3, () => removeServerApi(id, token));
    if (!ok4) { setFinished(true); return; }

    const ok5 = await runStep(4, () => deleteDnsRecordApi(id, token));
    setFinished(true);
    if (ok5) {
      addToast(`Server ${id} deleted`, 'success');
      props.onDeleted();
    }
  };

  const statusIcon = (status: StepStatus) => {
    if (status === 'pending') return <span class="create-server-step-icon pending">·</span>;
    if (status === 'loading') return <span class="create-server-step-icon loading"><span class="create-server-spinner" /></span>;
    if (status === 'done') return <span class="create-server-step-icon done">✓</span>;
    return <span class="create-server-step-icon error">✗</span>;
  };

  return (
    <div class="modal-overlay" onClick={() => { if (phase() === 'input') props.onClose(); }}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 480px">
        <div class="modal-header">
          <h2>
            {phase() === 'input' && 'Delete Server'}
            {phase() === 'confirm' && 'Are you sure?'}
            {phase() === 'progress' && 'Deleting Server'}
          </h2>
          {phase() === 'input' && (
            <button class="modal-close" onClick={() => props.onClose()}>✕</button>
          )}
        </div>
        <div class="modal-body">
          {phase() === 'input' && (
            <div class="docker-pull-form">
              <p style="color: #f87171; margin-bottom: 12px">
                This will permanently delete <strong>{props.serverId}</strong> and all associated infrastructure.
              </p>
              <label for="delete-confirm-input">
                Type <strong>{expectedText}</strong> to confirm
              </label>
              <input
                id="delete-confirm-input"
                type="text"
                class="version-input"
                style="margin-top: 8px"
                value={inputValue()}
                onInput={(e) => setInputValue(e.currentTarget.value)}
                placeholder={expectedText}
                autofocus
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
                  class="action-btn"
                  style="flex: 1; background: #dc2626"
                  onClick={() => setPhase('confirm')}
                  disabled={inputValue() !== expectedText}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {phase() === 'confirm' && (
            <div class="docker-pull-form">
              <p style="color: #f87171; margin-bottom: 16px">
                This action is <strong>permanent</strong> and cannot be undone. The server, its DNS record, nginx config, and SSL certificate will all be removed.
              </p>
              <div style="display: flex; gap: 8px; margin-top: 8px">
                <button
                  type="button"
                  class="action-btn"
                  style="flex: 1; background: #444"
                  onClick={() => setPhase('input')}
                >
                  Go Back
                </button>
                <button
                  type="button"
                  class="action-btn"
                  style="flex: 1; background: #dc2626"
                  onClick={handleDelete}
                >
                  Yes, Delete Permanently
                </button>
              </div>
            </div>
          )}
          {phase() === 'progress' && (
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
