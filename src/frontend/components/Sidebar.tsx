import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import type { ViewType } from '../types.ts';

export interface SidebarAction {
  label: string;
  iconPath: string;
  onClick: () => void;
}

interface SidebarProps {
  activeView: () => ViewType;
  onSelect: (view: ViewType) => void;
  actions?: SidebarAction[];
}

const icon = (d: string): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d={d} />
  </svg>
);

interface NavItem {
  id: ViewType;
  label: string;
  iconPath: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Infrastructure',
    items: [
      { id: 'servers', label: 'Servers', iconPath: 'M4 5h16v6H4zM4 13h16v6H4zM7 8h.01M7 16h.01' },
      { id: 'snapshots', label: 'Snapshots', iconPath: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5' },
      { id: 'volumeUsage', label: 'Volume Usage', iconPath: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6' },
    ],
  },
  {
    label: 'Activity',
    items: [
      { id: 'users', label: 'Users', iconPath: 'M16 19v-1a4 4 0 0 0-8 0v1M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7' },
      { id: 'userLogs', label: 'Usage Logs', iconPath: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' },
      { id: 'aiUsage', label: 'AI Usage', iconPath: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'pgStatements', label: 'Postgres Statements', iconPath: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5' },
      { id: 'moduleEditor', label: 'Module Definitions', iconPath: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
      { id: 'changelog', label: 'History', iconPath: 'M12 8v4l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18' },
    ],
  },
];

export function Sidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = createSignal(localStorage.getItem('sidebarCollapsed') === 'true');

  createEffect(() => {
    document.documentElement.classList.toggle('sidebar-collapsed', collapsed());
    localStorage.setItem('sidebarCollapsed', String(collapsed()));
  });

  onCleanup(() => document.documentElement.classList.remove('sidebar-collapsed'));

  return (
    <aside class="app-sidebar">
      <nav class="sidebar-nav">
        <For each={NAV_GROUPS}>
          {(group) => (
            <div class="sidebar-group">
              <div class="sidebar-group-label">{group.label}</div>
              <For each={group.items}>
                {(item) => (
                  <button
                    type="button"
                    class={`sidebar-item ${props.activeView() === item.id ? 'active' : ''}`}
                    title={item.label}
                    onClick={() => props.onSelect(item.id)}
                  >
                    <span class="sidebar-item-icon">{icon(item.iconPath)}</span>
                    <span class="sidebar-label">{item.label}</span>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
        <Show when={(props.actions?.length ?? 0) > 0}>
          <div class="sidebar-group">
            <div class="sidebar-group-label">Actions</div>
            <For each={props.actions}>
              {(action) => (
                <button
                  type="button"
                  class="sidebar-item"
                  title={action.label}
                  onClick={() => action.onClick()}
                >
                  <span class="sidebar-item-icon">{icon(action.iconPath)}</span>
                  <span class="sidebar-label">{action.label}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </nav>
      <button
        type="button"
        class="sidebar-item sidebar-collapse-btn"
        title={collapsed() ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={() => setCollapsed(c => !c)}
      >
        <span class="sidebar-item-icon">
          {icon(collapsed() ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6')}
        </span>
        <span class="sidebar-label">Collapse</span>
      </button>
    </aside>
  );
}
