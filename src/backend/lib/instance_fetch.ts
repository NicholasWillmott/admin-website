/// <reference lib="deno.ns" />
// Every server-side call to a FASTR instance goes through here. The instance
// routes the status site reads (health_check, user_logs*, ai_*, user_activity,
// pg_stat_statements*, dhis2-indicators-export) require the fleet
// status-api-key header and answer 401 without it. Timeouts are opt-in so no
// caller gets one it did not already have.
export function instanceFetch(
  serverId: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const key = Deno.env.get("STATUS_API_KEY");
  if (!key) {
    return Promise.reject(new Error("STATUS_API_KEY is not configured on the status site"));
  }
  const { timeoutMs, headers, ...rest } = init;
  const h = new Headers(headers);
  h.set("status-api-key", key);
  return fetch(`https://${serverId}.fastr-analytics.org/${path.replace(/^\//, "")}`, {
    ...rest,
    headers: h,
    signal: rest.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
  });
}
