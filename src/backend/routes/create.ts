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

async function readCategoriesData(): Promise<CategoriesData> {
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

// Assign a server to a category
router.post("/create/assign-category", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const body = await c.req.json<{ serverId: string; category: string }>();
  const { serverId, category } = body;

  if (!isSafeParam(serverId)) {
    return c.json({ success: false, error: "Invalid server ID" });
  }

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
  return c.json({ success: true });
});

// Pre-flight conflict check for a new server
router.get("/create/check/:serverId", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;

  const serverId = c.req.param('serverId');
  if (!isSafeParam(serverId)) {
    return c.json({ success: false, error: "Invalid server ID" });
  }

  const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
  const dropletIp = getDropletIp();

  const volume = c.req.query('volume');

  const checks: Promise<boolean>[] = [
    // DNS record check
    fetch(
      `https://api.digitalocean.com/v2/domains/fastr-analytics.org/records?name=${serverId}&type=A`,
      { headers: { "Authorization": `Bearer ${doToken}` } }
    ).then(r => r.json()).then(d => (d.domain_records?.length ?? 0) > 0).catch(() => false),

    // wb config check
    executeCommand(dropletIp, `wb c show ${serverId}`).then(r => r.success).catch(() => false),

    // nginx check
    executeCommand(dropletIp, `wb list-nginx`).then(r => r.stdout.split('\n').map((s: string) => s.trim()).includes(serverId)).catch(() => false),

    // SSL check
    executeCommand(dropletIp, `wb list-ssl`).then(r => r.stdout.split('\n').map((s: string) => s.trim()).includes(serverId)).catch(() => false),

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

  const [dnsResult, configResult, nginxResult, sslResult, serversJsonResult, directoryResult] = await Promise.all(checks);

  return c.json({
    success: true,
    conflicts: {
      dns: dnsResult,
      config: configResult,
      nginx: nginxResult,
      ssl: sslResult,
      serversJson: serversJsonResult,
      ...(volume ? { directory: directoryResult } : {}),
    },
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
