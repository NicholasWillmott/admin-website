import { describeBusy, readBusy } from "../../frontend/instance_busy.ts";
import type { InstanceBusy } from "../../frontend/instance_busy.ts";

// null = not busy, or the instance cannot be asked (down, timed out, bad
// response). A server that cannot answer is often the reason for the restart,
// so it never blocks one.
export async function fetchInstanceBusy(serverId: string): Promise<InstanceBusy | null> {
  try {
    const response = await fetch(`https://${serverId}.fastr-analytics.org/health_check`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    return readBusy(await response.json());
  } catch {
    return null;
  }
}

/** Busy targets among `ids`, mapped to what they are running. Empty when none. */
export async function findBusy(ids: string[]): Promise<Record<string, string>> {
  const results = await Promise.all(ids.map(async (id) => [id, await fetchInstanceBusy(id)] as const));
  const busy: Record<string, string> = {};
  for (const [id, b] of results) {
    if (b) busy[id] = describeBusy(b);
  }
  return busy;
}

/**
 * Refusal message for a restart / stop / update that would kill running work,
 * or null when every target is free. Checked before any wb command (on update,
 * before `wb c update` rewrites the registry).
 */
export async function busyRefusal(ids: string[]): Promise<{ error: string; busy: Record<string, string> } | null> {
  const busy = await findBusy(ids);
  const entries = Object.entries(busy);
  if (entries.length === 0) return null;
  const list = entries.map(([id, what]) => `${id} (${what.charAt(0).toLowerCase()}${what.slice(1)})`).join(", ");
  return {
    error: `Not done, busy: ${list}. Wait for that work to finish; restarting or stopping now would kill it.`,
    busy,
  };
}
