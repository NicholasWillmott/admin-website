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

// Get indiviudal server's info for the cards
async function getServerInfo(serverId: string) {
  const response = await fetch("https://central.fastr-analytics.org/servers.json");
  const servers = await response.json();
  return servers.find((s: any) => s.id === serverId);
}

app.get("/", (c) => c.text("Admin Website Backend is running"));

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

// Get the information such as:
// running
// instanceName
// uptime
// language
// total users
// admin users emails
// projects
// calendar
app.get("/api/servers/:id/status", async (c) => {
    const serverId = c.req.param("id");
    try{
       const response = await fetch(`https://${serverId}.fastr-analytics.org/health_check`);
       const data = await response.json();
       return c.json(data);
    }catch (error) {
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

// get all of the versions that we are able to update to
app.get("api/versions", async (c) => {
    const command = `docker images --format "{{.Tag}}" timroberton/comb`;

    try{
        const result = await executeCommand(DROPLET_IP, command);
        
        if (!result.success) {
            return c.json({ error: result.stderr }, 500);
        }

        // Parse the output and filter for wb-fastr-server-v* tags
        const tags = result.stdout
            .split('\n')
            .filter(tag => tag.startsWith('wb-fastr-server-v'))
            .map(tag => tag.replace('wb-fastr-server-v', ''));
        
        // Find the highest minor version (middle number)
        let highestMinor = -1;
        tags.forEach(version => {
            const parts = version.split('.');
            if (parts.length >= 2) {
                const minor = parseInt(parts[1]);
                if (minor > highestMinor) {
                    highestMinor = minor;
                }
            }
        });
        
        // Filter to only include versions with the highest minor version
        const filteredTags = tags
            .filter(version => {
                const parts = version.split('.');
                return parts.length >= 2 && parseInt(parts[1]) === highestMinor;
            })
            .sort((a, b) => {
                // Sort by semantic version (newest first)
                const aParts = a.split('.').map(Number);
                const bParts = b.split('.').map(Number);
                
                for (let i = 0; i < 3; i++) {
                    if (bParts[i] !== aParts[i]) {
                        return bParts[i] - aParts[i];
                    }
                }
                return 0;
            });
        
        return c.json({ versions: filteredTags });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// get servers docker logs
app.get("/api/servers/:id/logs", async (c) =>{
    const serverId = c.req.param("id");
    const command = `docker logs ${serverId}`;
    try {
        const result = await executeCommand(DROPLET_IP, command);

        if(!result.success) {
            return c.json({ success: false, logs: '', error: result.stderr});
        }

        return c.json({ success: true, logs: result.stdout, error: ''});
    } catch (error) {
        return c.json({ success: false, logs: '', error: String(error) });
    }
});

const PORT = parseInt(Deno.env.get("PORT") || "3001");
console.log(`🚀 Server running on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, app.fetch);