import { For, Show } from 'solid-js';
import type { Server, VolumeUsage } from '../../types.ts';

interface VolumeUsageViewProps {
  servers: Server[] | undefined;
  volumeUsages: Record<string, VolumeUsage | null>;
  loading: boolean;
  error: Error | undefined;
  onRefetch: () => void;
}

export function VolumeUsageView(props: VolumeUsageViewProps) {
  // Collect unique volume names across all servers
  const uniqueVolumes = () => {
    const names = new Set<string>();
    for (const server of props.servers ?? []) {
      if (server.volume) names.add(server.volume);
    }
    return [...names].sort();
  };

  type VolumeRow =
    | { kind: 'server'; server: Server; dirName: string; sizeGB: number }
    | { kind: 'other'; dirName: string; sizeGB: number };

  // Rows for a volume: matched servers + unmatched directories as "Other"
  const rowsForVolume = (volumeName: string): VolumeRow[] => {
    const usage = props.volumeUsages[volumeName];
    const serversOnVolume = (props.servers ?? []).filter(s => s.volume === volumeName);
    const knownDirNames = new Set(serversOnVolume.map(s => s.instanceDir ?? s.id));

    const serverRows: VolumeRow[] = serversOnVolume.map(s => {
      const dirName = s.instanceDir ?? s.id;
      const dir = usage?.directories.find(d => d.name === dirName);
      return { kind: 'server', server: s, dirName, sizeGB: dir?.sizeGB ?? 0 };
    });

    const otherRows: VolumeRow[] = (usage?.directories ?? [])
      .filter(d => !knownDirNames.has(d.name))
      .map(d => ({ kind: 'other', dirName: d.name, sizeGB: d.sizeGB }));

    return [...serverRows, ...otherRows].sort((a, b) => b.sizeGB - a.sizeGB);
  };

  return (
    <div class="volume-usage-container">
      <div class="volume-usage-content">
        <div class="volume-usage-header">
          <h2 class="volume-usage-title">Volume Usage</h2>
          <button class="system-btn" onClick={() => props.onRefetch()}>
            Refresh
          </button>
        </div>

        <Show when={props.loading}>
          <div class="volume-usage-loading">
            <div class="spinner"></div>
            <p>Loading volume usage...</p>
          </div>
        </Show>

        <Show when={!props.loading && props.error}>
          <div class="volume-usage-error">
            <p>Error loading volume usage: {props.error?.message}</p>
          </div>
        </Show>

        <Show when={!props.loading && !props.error}>
          <For each={uniqueVolumes()}>
            {(volumeName) => {
              const usage = () => props.volumeUsages[volumeName];
              const df = () => usage()?.df;
              const servers = () => rowsForVolume(volumeName);
              const usedPercent = () => df()?.usePercent ?? 0;
              const usedColor = () =>
                usedPercent() >= 90 ? '#ef4444' :
                usedPercent() >= 75 ? '#f59e0b' :
                '#22c55e';

              return (
                <div class="volume-block">
                  <div class="volume-block-header">
                    <div class="volume-block-name">/mnt/{volumeName}</div>
                    <Show when={df()}>
                      <div class="volume-block-stats">
                        <span class="volume-stat">{df()!.usedGB} GB used</span>
                        <span class="volume-stat-sep">/</span>
                        <span class="volume-stat">{df()!.totalGB} GB total</span>
                        <span class="volume-stat-sep">·</span>
                        <span class="volume-stat">{df()!.availableGB} GB free</span>
                      </div>
                    </Show>
                  </div>

                  <Show when={df()}>
                    <div class="volume-usage-bar-track">
                      <div
                        class="volume-usage-bar-fill"
                        style={{ width: `${usedPercent()}%`, background: usedColor() }}
                      />
                    </div>
                    <div class="volume-usage-bar-label">{usedPercent()}% used</div>
                  </Show>

                  <Show when={!usage()}>
                    <div class="volume-no-data">Could not load usage data for this volume.</div>
                  </Show>

                  <Show when={servers().length > 0}>
                    <table class="volume-servers-table">
                      <thead>
                        <tr>
                          <th>Server</th>
                          <th>Directory</th>
                          <th>Size</th>
                          <th>% of Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={servers()}>
                          {(row) => {
                            const pct = () =>
                              df() && df()!.totalGB > 0
                                ? ((row.sizeGB / df()!.totalGB) * 100).toFixed(1)
                                : '—';
                            return (
                              <tr>
                                <td class="volume-server-label">
                                  {row.kind === 'server' ? row.server.label : <span class="volume-other-label">Not in use</span>}
                                </td>
                                <td class="volume-server-dir">{row.dirName}</td>
                                <td class="volume-server-size">
                                  {row.sizeGB > 0 ? `${row.sizeGB} GB` : '< 1 GB'}
                                </td>
                                <td class="volume-server-pct">
                                  <Show when={row.sizeGB > 0 && df()}>
                                    <div class="volume-server-pct-bar-track">
                                      <div
                                        class="volume-server-pct-bar-fill"
                                        style={{ width: `${Math.min(parseFloat(pct() as string), 100)}%` }}
                                      />
                                    </div>
                                  </Show>
                                  <span>{pct()}%</span>
                                </td>
                              </tr>
                            );
                          }}
                        </For>
                      </tbody>
                    </table>
                  </Show>
                </div>
              );
            }}
          </For>

          <Show when={uniqueVolumes().length === 0}>
            <div class="volume-no-data">
              <p>No volumes configured. Add a <code>volume</code> field to servers in servers.json.</p>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
