import { createSignal, For } from 'solid-js';
import type { Server } from '../../types.ts';
import { exportIndicatorsCsvApi } from '../../services.ts';

interface IndicatorsExportModalProps {
  servers: Server[];
  getToken: () => Promise<string | null>;
  onClose: () => void;
}

export function IndicatorsExportModal(props: IndicatorsExportModalProps) {
  const allIds = () => props.servers.map((s) => s.id);
  const [selectedIds, setSelectedIds] = createSignal<string[]>(allIds());
  const [loading, setLoading] = createSignal(false);

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleExport = async () => {
    if (selectedIds().length === 0) return;
    setLoading(true);
    const token = await props.getToken();
    await exportIndicatorsCsvApi(selectedIds(), token);
    setLoading(false);
    props.onClose();
  };

  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class="modal-content" style={{ width: '480px', 'max-height': '80vh', display: 'flex', 'flex-direction': 'column' }} onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>Export Indicators CSV</h2>
          <button class="modal-close" onClick={props.onClose}>✕</button>
        </div>
        <div class="modal-body" style={{ flex: '1', overflow: 'hidden', display: 'flex', 'flex-direction': 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', 'border-radius': '6px', padding: '4px 10px', 'font-size': '12px', cursor: 'pointer' }}
              onClick={() => setSelectedIds(allIds())}
            >
              All
            </button>
            <button
              type="button"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1', 'border-radius': '6px', padding: '4px 10px', 'font-size': '12px', cursor: 'pointer' }}
              onClick={() => setSelectedIds([])}
            >
              None
            </button>
            <span style={{ color: '#94a3b8', 'font-size': '13px', 'margin-left': 'auto', 'align-self': 'center' }}>
              {selectedIds().length} / {props.servers.length} selected
            </span>
          </div>
          <div style={{ 'overflow-y': 'auto', flex: '1', display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <For each={props.servers}>
              {(server) => {
                const checked = () => selectedIds().includes(server.id);
                return (
                  <label
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      'border-radius': '6px',
                      cursor: 'pointer',
                      background: checked() ? 'rgba(13,148,136,0.1)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${checked() ? 'rgba(13,148,136,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked()}
                      onChange={() => toggle(server.id)}
                      style={{ 'accent-color': '#0d9488', width: '15px', height: '15px', cursor: 'pointer' }}
                    />
                    <span style={{ color: '#e2e8f0', 'font-size': '14px', flex: '1' }}>{server.label}</span>
                    <span style={{ color: '#64748b', 'font-size': '12px', 'font-family': 'monospace' }}>{server.id}</span>
                  </label>
                );
              }}
            </For>
          </div>
          <button
            type="button"
            class="action-btn"
            style={{ background: 'linear-gradient(135deg, #0d9488 0%, #065f59 100%)', color: 'white', border: 'none', opacity: (loading() || selectedIds().length === 0) ? '0.5' : '1', cursor: (loading() || selectedIds().length === 0) ? 'not-allowed' : 'pointer' }}
            disabled={loading() || selectedIds().length === 0}
            onClick={handleExport}
          >
            {loading() ? 'Downloading...' : 'Download CSV'}
          </button>
        </div>
      </div>
    </div>
  );
}
