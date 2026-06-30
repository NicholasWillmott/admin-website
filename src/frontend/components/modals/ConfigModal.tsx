import { createSignal, For } from 'solid-js';
import type { Server } from '../../types.ts';
import type { ServerCategory } from '../../services.ts';

type ConfigChanges = { french?: boolean; portuguese?: boolean; ethiopian?: boolean; openAccess?: boolean; label?: string; category?: string };

type Language = 'english' | 'french' | 'portuguese';

function serverLanguage(server: Server): Language {
  if (server.portuguese) return 'portuguese';
  if (server.french) return 'french';
  return 'english';
}

interface ConfigModalProps {
  server: Server;
  sshOperationInProgress: boolean;
  categories: ServerCategory[];
  currentCategory: string;
  onClose: () => void;
  onSave: (serverId: string, changes: ConfigChanges) => Promise<void>;
}

export function ConfigModal(props: ConfigModalProps) {
  const [language, setLanguage] = createSignal<Language>(serverLanguage(props.server));
  const [ethiopian, setEthiopian] = createSignal(props.server.ethiopian ?? false);
  const [openAccess, setOpenAccess] = createSignal(props.server.openAccess ?? false);
  const [label, setLabel] = createSignal(props.server.label);
  const [category, setCategory] = createSignal(props.currentCategory);

  const hasChanges = () =>
    language() !== serverLanguage(props.server) ||
    ethiopian() !== (props.server.ethiopian ?? false) ||
    openAccess() !== (props.server.openAccess ?? false) ||
    label() !== props.server.label ||
    category() !== props.currentCategory;

  const handleSave = async () => {
    const changes: ConfigChanges = {};
    if (language() !== serverLanguage(props.server)) {
      // Language is mutually exclusive — always send both flags together.
      changes.french = language() === 'french';
      changes.portuguese = language() === 'portuguese';
    }
    if (ethiopian() !== (props.server.ethiopian ?? false)) changes.ethiopian = ethiopian();
    if (openAccess() !== (props.server.openAccess ?? false)) changes.openAccess = openAccess();
    if (label() !== props.server.label) changes.label = label();
    if (category() !== props.currentCategory) changes.category = category();
    await props.onSave(props.server.id, changes);
  };

  return (
    <div class="modal-overlay" onClick={() => props.onClose()}>
      <div class="modal-content" onClick={(e) => e.stopPropagation()} style="max-width: 420px">
        <div class="modal-header">
          <h2>Configuration — {props.server.label}</h2>
          <button class="modal-close" onClick={() => props.onClose()}>✕</button>
        </div>
        <div class="modal-body">
          <div class="config-rows">

            <div class="config-row">
              <span class="config-label">Label</span>
              <input
                type="text"
                value={label()}
                onInput={(e) => setLabel(e.currentTarget.value)}
                class="modal-input"
                style="flex: 1"
              />
            </div>

            <div class="config-row">
              <span class="config-label">Language</span>
              <div class="config-toggle-group">
                <button
                  type="button"
                  class={`config-toggle-btn ${language() === 'english' ? 'active' : ''}`}
                  onClick={() => setLanguage('english')}
                >
                  English
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${language() === 'french' ? 'active' : ''}`}
                  onClick={() => setLanguage('french')}
                >
                  French
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${language() === 'portuguese' ? 'active' : ''}`}
                  onClick={() => setLanguage('portuguese')}
                >
                  Portuguese
                </button>
              </div>
            </div>

            <div class="config-row">
              <span class="config-label">Calendar</span>
              <div class="config-toggle-group">
                <button
                  type="button"
                  class={`config-toggle-btn ${!ethiopian() ? 'active' : ''}`}
                  onClick={() => setEthiopian(false)}
                >
                  Gregorian
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${ethiopian() ? 'active' : ''}`}
                  onClick={() => setEthiopian(true)}
                >
                  Ethiopian
                </button>
              </div>
            </div>

            <div class="config-row">
              <span class="config-label">Category</span>
              <select
                value={category()}
                onChange={(e) => setCategory(e.currentTarget.value)}
                class="modal-input"
                style="flex: 1"
              >
                <option value="">None (Misc)</option>
                <For each={props.categories}>
                  {(cat) => <option value={cat.name}>{cat.name}</option>}
                </For>
              </select>
            </div>

            <div class="config-row">
              <span class="config-label">Open Access</span>
              <div class="config-toggle-group">
                <button
                  type="button"
                  class={`config-toggle-btn ${!openAccess() ? 'active' : ''}`}
                  onClick={() => setOpenAccess(false)}
                >
                  Off
                </button>
                <button
                  type="button"
                  class={`config-toggle-btn ${openAccess() ? 'active' : ''}`}
                  onClick={() => setOpenAccess(true)}
                >
                  On
                </button>
              </div>
            </div>

          </div>

          <button
            type="button"
            class="action-btn docker-pull"
            style="width: 100%; margin-top: 20px"
            disabled={!hasChanges() || props.sshOperationInProgress}
            onClick={handleSave}
          >
            {props.sshOperationInProgress ? 'SSH Operation in Progress...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
