/// <reference lib="deno.ns" />
import { load } from "@std/dotenv";

// Load .env file at startup
await load({ export: true });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { executeCommand, isCommandAllowed } from "./ssh.ts";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  credentials: true,
}));

// Droplet IP where all servers are hosted
const DROPLET_IP = Deno.env.get("DROPLET_IP") || "159.223.167.134";

// Get indiviudal server's info
async function getServerInfo(serverId: string) {
  const response = await fetch("https://central.fastr-analytics.org/servers.json");
  const servers = await response.json();
  return servers.find((s: any) => s.id === serverId);
}

// Check server's status
app.get("/", (c) => c.json({ status: "ok" }));

// Restart individual server
app.post("/api/servers/:id/restart", async (c) => {
    const serverId = c.req.param("id");
    const server = await getServerInfo(serverId);

    if(!server || !server.id) {
        return c.json({ error: "Server not found" }, 404);
    }

    const command = `wb restart ${serverId}`;

    console.log(command);

    // if(!isCommandAllowed(command)) {
    //     return c.json({ error: "Command not allowed" }, 403);
    // }

    try{
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// update server version (need to run restart api after)
app.post("/api/servers/:id/update", async (c) => {
    const serverId = c.req.param("id");
    const { version } = await c.req.json();

    const server = await getServerInfo(serverId);

    if(!server || !server.id) {
        return c.json({ error: "Server not found" }, 404);
    }

    const command = `wb c update ${serverId} --server ${version}`

    console.log(command);

    // if(!isCommandAllowed(command)) {
    //     return c.json({ error: "Command not allowed" }, 403);
    // }


    // update server
    try{
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json ({ error: String(error) }, 500);
    }
})

const PORT = parseInt(Deno.env.get("PORT") || "3001");
console.log(`🚀 Server running on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, app.fetch);