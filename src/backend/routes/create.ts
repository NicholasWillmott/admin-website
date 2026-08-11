/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import { isSafeParam, getDropletIp } from "../lib/utils.ts";
import { executeCommand, isCommandAllowed } from "../ssh.ts";

const router = new Hono();

const CATEGORIES_FILE = new URL('../data/serverCategories.json', import.meta.url).pathname;

interface ServerCategory {
  name: string;
  servers: string[];
}

interface CategoriesData {
  categories: ServerCategory[];
}

export async function readCategoriesData(): Promise<CategoriesData> {
  try {
    const text = await Deno.readTextFile(CATEGORIES_FILE);
    return JSON.parse(text);
  } catch {
    return { categories: [] };
  }
}

async function writeCategoriesData(data: CategoriesData): Promise<void> {
  await Deno.writeTextFile(CATEGORIES_FILE, JSON.stringify(data, null, 2));
}

// Get all categories
router.get("/categories", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  return c.json(await readCategoriesData());
});

// Create a new category
router.post("/create/category", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const body = await c.req.json<{ name: string }>();
  const name = body.name?.trim();

  if (!name) {
    return c.json({ success: false, error: "Category name is required" });
  }

  const data = await readCategoriesData();
  if (data.categories.some(cat => cat.name === name)) {
    return c.json({ success: false, error: "Category already exists" });
  }
  data.categories.push({ name, servers: [] });
  await writeCategoriesData(data);
  return c.json({ success: true });
});

// Rename a category
router.put("/create/category", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const body = await c.req.json<{ oldName: string; newName: string }>();
  const oldName = body.oldName?.trim();
  const newName = body.newName?.trim();

  if (!oldName || !newName) {
    return c.json({ success: false, error: "Both old and new names are required" });
  }

  const data = await readCategoriesData();
  const cat = data.categories.find(c => c.name === oldName);
  if (!cat) {
    return c.json({ success: false, error: "Category not found" });
  }
  if (data.categories.some(c => c.name === newName)) {
    return c.json({ success: false, error: "A category with that name already exists" });
  }
  cat.name = newName;
  await writeCategoriesData(data);
  return c.json({ success: true });
});

// Delete a category (servers become uncategorized)
router.delete("/create/category/:name", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const name = decodeURIComponent(c.req.param('name'));
  const data = await readCategoriesData();
  const idx = data.categories.findIndex(cat => cat.name === name);
  if (idx === -1) {
    return c.json({ success: false, error: "Category not found" });
  }
  data.categories.splice(idx, 1);
  await writeCategoriesData(data);
  return c.json({ success: true });
});

// Move a server into a category (or out of all of them when category is
// empty). Shared with the MCP create_server tool.
export async function assignServerToCategory(serverId: string, category: string): Promise<void> {
  const data = await readCategoriesData();
  // Remove from any existing category first
  for (const cat of data.categories) {
    cat.servers = cat.servers.filter(id => id !== serverId);
  }
  // Add to the new category if specified
  if (category) {
    const target = data.categories.find(cat => cat.name === category);
    if (target) {
      target.servers.push(serverId);
    }
  }
  await writeCategoriesData(data);
}

// Assign a server to a category
router.post("/create/assign-category", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const body = await c.req.json<{ serverId: string; category: string }>();
  const { serverId, category } = body;

  if (!isSafeParam(serverId)) {
    return c.json({ success: false, error: "Invalid server ID" });
  }

  await assignServerToCategory(serverId, category);
  return c.json({ success: true });
});

// Whether wb list-nginx / wb list-ssl output mentions this server's hostname.
// Both commands print decorated lines ("  testing2.fastr-analytics.org → port
// 9013", "Certificate Name: testing2.fastr-analytics.org") wrapped in ANSI
// color codes, so an exact line === serverId comparison can never match — the
// nginx/ssl (and bare-name DNS) checks were silently ineffective until
// 2026-08-10. Match the full hostname as a token: the boundary guard keeps
// "ai" from matching "afghanistan-ai.fastr-analytics.org".
function outputMentionsHost(output: string, serverId: string): boolean {
  // deno-lint-ignore no-control-regex
  const plain = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  return new RegExp(`(^|[^\\w-])${serverId}\\.fastr-analytics\\.org`, "m").test(plain);
}

// Pre-flight conflict checks for a new server id: true = that thing already
// exists. Shared by the check route below and the MCP create_server tool.
// Individual check failures degrade to false (no conflict), same as always —
// the wb add/init steps still fail loudly if a degraded check missed something.
export async function checkServerConflicts(
  serverId: string,
  volume: string | undefined,
): Promise<Record<string, boolean>> {
  const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
  const dropletIp = getDropletIp();

  const checks: Promise<boolean>[] = [
    // DNS record check — the DO API's name filter needs the FULL record name;
    // a bare subdomain silently matches nothing
    fetch(
      `https://api.digitalocean.com/v2/domains/fastr-analytics.org/records?name=${serverId}.fastr-analytics.org&type=A`,
      { headers: { "Authorization": `Bearer ${doToken}` } }
    ).then(r => r.json()).then(d => (d.domain_records?.length ?? 0) > 0).catch(() => false),

    // wb config check
    executeCommand(dropletIp, `wb c show ${serverId}`).then(r => r.success).catch(() => false),

    // nginx check
    executeCommand(dropletIp, `wb list-nginx`).then(r => outputMentionsHost(r.stdout, serverId)).catch(() => false),

    // SSL check
    executeCommand(dropletIp, `wb list-ssl`).then(r => outputMentionsHost(r.stdout, serverId)).catch(() => false),

    // central servers.json check
    fetch("https://central.fastr-analytics.org/servers.json")
      .then(r => r.json()).then((servers: { id: string }[]) => servers.some(s => s.id === serverId)).catch(() => false),
  ];

  // Directory check — only if a volume is specified
  if (volume && /^[\w_-]+$/.test(volume)) {
    checks.push(
      executeCommand(dropletIp, `du -BG --max-depth=1 /mnt/${volume}`)
        .then(r => r.stdout.trim().split('\n').some(line => {
          const dir = line.trim().split(/\s+/)[1];
          return dir?.split('/').at(-1) === serverId;
        }))
        .catch(() => false)
    );
  }

  const [dns, config, nginx, ssl, serversJson, directory] = await Promise.all(checks);
  return {
    dns,
    config,
    nginx,
    ssl,
    serversJson,
    ...(volume ? { directory } : {}),
  };
}

// Pre-flight conflict check for a new server
router.get("/create/check/:serverId", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const serverId = c.req.param('serverId');
  if (!isSafeParam(serverId)) {
    return c.json({ success: false, error: "Invalid server ID" });
  }

  const volume = c.req.query('volume');
  return c.json({
    success: true,
    conflicts: await checkServerConflicts(serverId, volume),
  });
});

// Create DNS A record for new server
router.post("/create/record", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ subdomain: string }>();
    const subdomain = body.subdomain;

    if (!isSafeParam(subdomain)) {
        return c.json({ success: false, error: "Invalid subdomain" });
    }

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const dropletIp = Deno.env.get("DROPLET_IP");

    try {
        const response = await fetch("https://api.digitalocean.com/v2/domains/fastr-analytics.org/records", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${doToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "A",
                name: subdomain,
                data: dropletIp,
                ttl: 3600,
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            return c.json({ success: false, error: result.message || "Failed to create DNS record" }, response.status as any);
        }

        return c.json({ success: true, record: result.domain_record });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// Add server to config
router.post("/create/server", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb c add ${serverId}`;

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, error: "Invalid command" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Init nginx for server
router.post("/create/nginx", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-nginx ${serverId}`;

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, error: "Invalid command" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Init SSL for server
router.post("/create/ssl", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-ssl ${serverId}`;

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, error: "Invalid command" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Init directories for server
router.post("/create/dirs", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-dirs ${serverId}`;

    if (!isCommandAllowed(command)) {
        return c.json({ success: false, error: "Invalid command" });
    }

    try {
        const result = await executeCommand(getDropletIp(), command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

export default router;
