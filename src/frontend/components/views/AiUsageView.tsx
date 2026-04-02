import { For, Show, createMemo } from 'solid-js';
import type { Server, AiUsageLog, ServerAiUsageLogs, ModelPricing } from '../../types.ts';

interface AiUsageViewProps {
  servers: Server[] | undefined;
  aiUsageLogs: ServerAiUsageLogs | undefined;
  pricing: Record<string, ModelPricing> | undefined;
  loading: boolean;
  error: Error | undefined;
  onRefetch: () => void;
}

function computeCost(log: AiUsageLog, pricing: Record<string, ModelPricing>): number {
  const p = pricing[log.model];
  if (!p) return 0;
  return (log.input_tokens * (p.input_cost_per_token ?? 0))
    + (log.output_tokens * (p.output_cost_per_token ?? 0))
    + (log.cache_creation_input_tokens * (p.cache_creation_input_token_cost ?? 0))
    + (log.cache_read_input_tokens * (p.cache_read_input_token_cost ?? 0));
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
  const rows = createMemo(() => {
    const servers = props.servers ?? [];
    const logs = props.aiUsageLogs ?? {};
    const pricing = props.pricing ?? {};

    return servers.map(server => {
      const serverLogs = logs[server.id] ?? [];
      const totals = serverLogs.reduce(
        (acc, log) => ({
          requests: acc.requests + 1,
          inputTokens: acc.inputTokens + log.input_tokens,
          outputTokens: acc.outputTokens + log.output_tokens,
          cacheReadTokens: acc.cacheReadTokens + log.cache_read_input_tokens,
          cacheCreationTokens: acc.cacheCreationTokens + log.cache_creation_input_tokens,
          cost: acc.cost + computeCost(log, pricing),
        }),
        { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cost: 0 },
      );
      return { server, ...totals };
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
      { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cost: 0 },
    )
  );

  return (
    <div class="ai-usage-container">
      <div class="ai-usage-content">
        <div class="ai-usage-header">
          <h2 class="ai-usage-title">AI Usage</h2>
          <button class="system-btn" onClick={() => props.onRefetch()}>Refresh</button>
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
                {(row) => (
                  <tr class={row.requests === 0 ? 'ai-usage-row-empty' : ''}>
                    <td class="ai-usage-instance">{row.server.label}</td>
                    <td class="ai-usage-num">{row.requests.toLocaleString()}</td>
                    <td class="ai-usage-num">{formatTokens(row.inputTokens)}</td>
                    <td class="ai-usage-num">{formatTokens(row.outputTokens)}</td>
                    <td class="ai-usage-num">{formatTokens(row.cacheReadTokens)}</td>
                    <td class="ai-usage-num">{formatTokens(row.cacheCreationTokens)}</td>
                    <td class="ai-usage-cost">{formatCost(row.cost)}</td>
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

          <Show when={rows().every(r => r.requests === 0)}>
            <div class="ai-usage-empty">
              <p>No AI usage recorded yet across any instance.</p>
            </div>
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
