import { For, Show } from 'solid-js';
import type { Server, ServerStatuses } from '../../types.ts';

interface ActiveInstancesBarProps {
  instances: Server[];
  statuses: ServerStatuses | undefined;
  loading: boolean;
}

export function ActiveInstancesBar(props: ActiveInstancesBarProps) {
  return (
    <Show when={props.loading || props.instances.length > 0}>
      <div class="active-instances-bar">
        <span class="active-instances-label">Active now:</span>
        <Show when={props.loading} fallback={
          <For each={props.instances}>
            {(server) => {
              const log = props.statuses?.[server.id]?.lastUserLog!;
              return (
                <span class="active-instance-chip" title={`${log.userEmail} — ${new Date(log.timestamp).toLocaleTimeString()}`}>
                  {server.label}
                </span>
              );
            }}
          </For>
        }>
          <span class="active-instances-loading">Loading...</span>
        </Show>
      </div>
    </Show>
  );
}
