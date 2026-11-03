import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import {
  fetchRegistry,
  fetchSnapshot,
  isCountryInstance,
  isV2,
  type ModuleDefaultsSnapshot,
} from "../lib/module_defaults.ts";
import { mapConcurrent } from "../mcp/tools/helpers.ts";

const router = new Hono();

export interface ModuleDefaultsCountry {
  id: string;
  label: string;
  iso3: string | null;
  serverVersion: string;
  french?: boolean;
  state: "ok" | "not_v2" | "unreachable";
  error?: string;
  snapshot?: ModuleDefaultsSnapshot;
}

// Every country's live module defaults, for the fleet matrix (contract in
// lib/module_defaults.ts). Read-only.
router.get("/", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const statusApiKey = Deno.env.get("STATUS_API_KEY");
  if (!statusApiKey) {
    return c.json({ error: "STATUS_API_KEY is not configured" }, 500);
  }

  const countries = (await fetchRegistry()).filter(isCountryInstance);
  const rows = await mapConcurrent(
    countries,
    8,
    async (server): Promise<ModuleDefaultsCountry> => {
      const base = {
        id: server.id,
        label: server.label,
        iso3: server.countryIso3 ?? null,
        serverVersion: server.serverVersion,
        french: server.french,
      };
      if (!isV2(server)) return { ...base, state: "not_v2" };
      try {
        return {
          ...base,
          state: "ok",
          snapshot: await fetchSnapshot(server.id, statusApiKey),
        };
      } catch (error) {
        return { ...base, state: "unreachable", error: String(error) };
      }
    },
  );

  return c.json({
    countries: rows.sort((a, b) => a.label.localeCompare(b.label)),
  });
});

export default router;
