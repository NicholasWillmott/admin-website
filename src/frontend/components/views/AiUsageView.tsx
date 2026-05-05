import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Server, AiUsageLog, ServerAiUsageLogs, ModelPricing } from '../../types.ts';

interface AiUsageViewProps {
  servers: Server[] | undefined;
  aiUsageLogs: ServerAiUsageLogs | undefined;
  pricing: Record<string, ModelPricing> | undefined;
  loading: boolean;
  error: Error | undefined;
  onRefetch: () => void;
}

interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cost: number;
}

const emptyTotals = (): UsageTotals => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cost: 0,
});

function computeCost(log: AiUsageLog, pricing: Record<string, ModelPricing>): number {
  const p = pricing[log.model];
  if (!p) return 0;
  return (log.input_tokens * (p.input_cost_per_token ?? 0))
    + (log.output_tokens * (p.output_cost_per_token ?? 0))
    + (log.cache_creation_input_tokens * (p.cache_creation_input_token_cost ?? 0))
    + (log.cache_read_input_tokens * (p.cache_read_input_token_cost ?? 0));
}

function addLog(totals: UsageTotals, log: AiUsageLog, pricing: Record<string, ModelPricing>): UsageTotals {
  return {
    requests: totals.requests + 1,
    inputTokens: totals.inputTokens + log.input_tokens,
    outputTokens: totals.outputTokens + log.output_tokens,
    cacheReadTokens: totals.cacheReadTokens + log.cache_read_input_tokens,
    cacheCreationTokens: totals.cacheCreationTokens + log.cache_creation_input_tokens,
    cost: totals.cost + computeCost(log, pricing),
  };
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `${(cost * 100).toFixed(3)}¢`;
  return `$${cost.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function AiUsageView(props: AiUsageViewProps) {
  const [dateFrom, setDateFrom] = createSignal('');
  const [dateTo, setDateTo] = createSignal('');
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [viewMode, setViewMode] = createSignal<'instance' | 'user'>('instance');

  const toggleExpanded = (serverId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
  };

  const rows = createMemo(() => {
    const servers = props.servers ?? [];
    const logs = props.aiUsageLogs ?? {};
    const pricing = props.pricing ?? {};
    const from = dateFrom() ? new Date(dateFrom()).getTime() : null;
    const to = dateTo() ? new Date(dateTo() + 'T23:59:59').getTime() : null;

    return servers.map(server => {
      const serverLogs = (logs[server.id] ?? []).filter(log => {
        const t = new Date(log.timestamp).getTime();
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
        return true;
      });

      const userMap = new Map<string, UsageTotals>();
      let totals = emptyTotals();
      for (const log of serverLogs) {
        totals = addLog(totals, log, pricing);
        const key = log.user_email || '(unknown)';
        userMap.set(key, addLog(userMap.get(key) ?? emptyTotals(), log, pricing));
      }

      const users = Array.from(userMap.entries())
        .map(([email, t]) => ({ email, ...t }))
        .sort((a, b) => b.cost - a.cost || b.requests - a.requests);

      return { server, users, ...totals };
    }).sort((a, b) => b.cost - a.cost);
  });

  const grandTotal = createMemo(() =>
    rows().reduce(
      (acc, row) => ({
        requests: acc.requests + row.requests,
        inputTokens: acc.inputTokens + row.inputTokens,
        outputTokens: acc.outputTokens + row.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + row.cacheReadTokens,
        cacheCreationTokens: acc.cacheCreationTokens + row.cacheCreationTokens,
        cost: acc.cost + row.cost,
      }),
      emptyTotals(),
    )
  );

  const userRows = createMemo(() => {
    const logs = props.aiUsageLogs ?? {};
    const pricing = props.pricing ?? {};
    const from = dateFrom() ? new Date(dateFrom()).getTime() : null;
    const to = dateTo() ? new Date(dateTo() + 'T23:59:59').getTime() : null;

    const userMap = new Map<string, UsageTotals>();
    for (const serverLogs of Object.values(logs)) {
      for (const log of serverLogs) {
        const t = new Date(log.timestamp).getTime();
        if (from !== null && t < from) continue;
        if (to !== null && t > to) continue;
        const key = log.user_email || '(unknown)';
        userMap.set(key, addLog(userMap.get(key) ?? emptyTotals(), log, pricing));
      }
    }

    return Array.from(userMap.entries())
      .map(([email, t]) => ({ email, ...t }))
      .sort((a, b) => b.cost - a.cost || b.requests - a.requests);
  });

  return (
    <div class="ai-usage-container">
      <div class="ai-usage-content">
        <div class="ai-usage-header">
          <div class="ai-usage-header-left">
            <h2 class="ai-usage-title">AI Usage</h2>
            <div class="ai-usage-view-toggle">
              <button
                class={`ai-usage-toggle-btn ${viewMode() === 'instance' ? 'active' : ''}`}
                onClick={() => setViewMode('instance')}
              >By Instance</button>
              <button
                class={`ai-usage-toggle-btn ${viewMode() === 'user' ? 'active' : ''}`}
                onClick={() => setViewMode('user')}
              >By User</button>
            </div>
          </div>
          <div class="ai-usage-filters">
            <input type="date" class="server-filter-input" value={dateFrom()} onChange={(e) => setDateFrom(e.currentTarget.value)} />
            <span class="ai-usage-filter-sep">to</span>
            <input type="date" class="server-filter-input" value={dateTo()} onChange={(e) => setDateTo(e.currentTarget.value)} />
            <button class="system-btn" onClick={() => props.onRefetch()}>Refresh</button>
          </div>
        </div>

        <Show when={props.loading}>
          <div class="ai-usage-loading">
            <div class="spinner" />
            <p>Loading AI usage...</p>
          </div>
        </Show>

        <Show when={!props.loading && props.error}>
          <div class="ai-usage-error">
            <p>Error loading AI usage: {props.error?.message}</p>
          </div>
        </Show>

        <Show when={!props.loading && !props.error}>
          <Show when={viewMode() === 'instance'}>
            <table class="ai-usage-table">
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>Requests</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Cache Read</th>
                  <th>Cache Creation</th>
                  <th>Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(row) => {
                    const isOpen = () => expanded().has(row.server.id);
                    const canExpand = () => row.users.length > 0;
                    return (
                      <>
                        <tr
                          class={`ai-usage-instance-row ${row.requests === 0 ? 'ai-usage-row-empty' : ''} ${canExpand() ? 'ai-usage-row-clickable' : ''}`}
                          onClick={() => canExpand() && toggleExpanded(row.server.id)}
                        >
                          <td class="ai-usage-instance">
                            <span class={`ai-usage-chevron ${isOpen() ? 'open' : ''} ${canExpand() ? '' : 'hidden'}`}>▶</span>
                            {row.server.label}
                          </td>
                          <td class="ai-usage-num">{row.requests.toLocaleString()}</td>
                          <td class="ai-usage-num">{formatTokens(row.inputTokens)}</td>
                          <td class="ai-usage-num">{formatTokens(row.outputTokens)}</td>
                          <td class="ai-usage-num">{formatTokens(row.cacheReadTokens)}</td>
                          <td class="ai-usage-num">{formatTokens(row.cacheCreationTokens)}</td>
                          <td class="ai-usage-cost">{formatCost(row.cost)}</td>
                        </tr>
                        <Show when={isOpen() && canExpand()}>
                          <tr class="ai-usage-user-header">
                            <td>User</td>
                            <td class="ai-usage-num">Requests</td>
                            <td class="ai-usage-num">Input</td>
                            <td class="ai-usage-num">Output</td>
                            <td class="ai-usage-num">Cache Read</td>
                            <td class="ai-usage-num">Cache Creation</td>
                            <td class="ai-usage-num">Cost</td>
                          </tr>
                          <For each={row.users}>
                            {(user) => (
                              <tr class="ai-usage-user-row">
                                <td class="ai-usage-user-email">{user.email}</td>
                                <td class="ai-usage-num">{user.requests.toLocaleString()}</td>
                                <td class="ai-usage-num">{formatTokens(user.inputTokens)}</td>
                                <td class="ai-usage-num">{formatTokens(user.outputTokens)}</td>
                                <td class="ai-usage-num">{formatTokens(user.cacheReadTokens)}</td>
                                <td class="ai-usage-num">{formatTokens(user.cacheCreationTokens)}</td>
                                <td class="ai-usage-cost">{formatCost(user.cost)}</td>
                              </tr>
                            )}
                          </For>
                        </Show>
                      </>
                    );
                  }}
                </For>
              </tbody>
              <tfoot>
                <tr class="ai-usage-total-row">
                  <td>Total</td>
                  <td class="ai-usage-num">{grandTotal().requests.toLocaleString()}</td>
                  <td class="ai-usage-num">{formatTokens(grandTotal().inputTokens)}</td>
                  <td class="ai-usage-num">{formatTokens(grandTotal().outputTokens)}</td>
                  <td class="ai-usage-num">{formatTokens(grandTotal().cacheReadTokens)}</td>
                  <td class="ai-usage-num">{formatTokens(grandTotal().cacheCreationTokens)}</td>
                  <td class="ai-usage-cost">{formatCost(grandTotal().cost)}</td>
                </tr>
              </tfoot>
            </table>

            <Show when={rows().every(r => r.requests === 0)}>
              <div class="ai-usage-empty">
                <p>No AI usage recorded yet across any instance.</p>
              </div>
            </Show>
          </Show>

          <Show when={viewMode() === 'user'}>
            <table class="ai-usage-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Requests</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Cache Read</th>
                  <th>Cache Creation</th>
                  <th>Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                <For each={userRows()}>
                  {(user) => (
                    <tr>
                      <td class="ai-usage-user-email" style="padding-left: 16px !important">{user.email}</td>
                      <td class="ai-usage-num">{user.requests.toLocaleString()}</td>
                      <td class="ai-usage-num">{formatTokens(user.inputTokens)}</td>
                      <td class="ai-usage-num">{formatTokens(user.outputTokens)}</td>
                      <td class="ai-usage-num">{formatTokens(user.cacheReadTokens)}</td>
                      <td class="ai-usage-num">{formatTokens(user.cacheCreationTokens)}</td>
                      <td class="ai-usage-cost">{formatCost(user.cost)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
              <tfoot>
                <tr class="ai-usage-total-row">
                  <td>Total</td>
                  <td class="ai-usage-num">{grandTotal().requests.toLocaleString()}</td>
                  <td class="ai-usage-num">{formatTokens(grandTotal().inputTokens)}</td>
                  <td class="ai-usage-num">{formatTokens(grandTotal().outputTokens)}</td>
                  <td class="ai-usage-num">{formatTokens(grandTotal().cacheReadTokens)}</td>
                  <td class="ai-usage-num">{formatTokens(grandTotal().cacheCreationTokens)}</td>
                  <td class="ai-usage-cost">{formatCost(grandTotal().cost)}</td>
                </tr>
              </tfoot>
            </table>

            <Show when={userRows().length === 0}>
              <div class="ai-usage-empty">
                <p>No AI usage recorded yet.</p>
              </div>
            </Show>
          </Show>

          <Show when={Object.keys(props.pricing ?? {}).length === 0}>
            <div class="ai-usage-warning">
              Could not load pricing data — costs shown as $0.00.
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
