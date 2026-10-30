// Shared by the frontend and the backend (routes + MCP). Same rules as
// server-cli's src/utils/instance-busy.ts, which gates `wb restart` / `wb stop`.

/** Work in progress on an instance that a restart or stop would kill. */
export type InstanceBusy = { generatingRuns: number; runningImports: string[] };

// null = not busy. Only the v2 `busy` field is read: a payload without it
// (pre-v2 instances), or no payload at all, is not busy.
export function readBusy(payload: unknown): InstanceBusy | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { busy?: unknown };
  if (p.busy && typeof p.busy === "object") {
    const busy = p.busy as Partial<InstanceBusy>;
    const generatingRuns = typeof busy.generatingRuns === "number" ? busy.generatingRuns : 0;
    const runningImports = Array.isArray(busy.runningImports)
      ? busy.runningImports.filter((s): s is string => typeof s === "string")
      : [];
    return generatingRuns > 0 || runningImports.length > 0
      ? { generatingRuns, runningImports }
      : null;
  }
  return null;
}

/** e.g. "Generating 1 results package; importing hmis" */
export function describeBusy(busy: InstanceBusy): string {
  const parts: string[] = [];
  if (busy.generatingRuns > 0) {
    parts.push(
      `generating ${busy.generatingRuns} results package${busy.generatingRuns === 1 ? "" : "s"}`,
    );
  }
  if (busy.runningImports.length > 0) {
    parts.push(`importing ${busy.runningImports.join(", ")}`);
  }
  const text = parts.join("; ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
