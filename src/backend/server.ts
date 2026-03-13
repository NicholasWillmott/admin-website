/// <reference lib="deno.ns" />
import { load } from "@std/dotenv";

// Load .env file at startup
await load({ export: true });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { executeCommand, isCommandAllowed } from "./ssh.ts";
import * as github from "./viz_editor/github.ts";



const app = new Hono();

app.use("*", cors({
  origin: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://status.fastr-analytics.org",
    "http://status.fastr-analytics.org",
  ],
  credentials: true,
}));

// Add Clerk middleware - this will verify JWT tokens from your frontend
app.use("*", clerkMiddleware({
  publishableKey: Deno.env.get("VITE_CLERK_PUBLISHABLE_KEY"),
  secretKey: Deno.env.get("CLERK_SECRET_KEY"),
}));

// Helper function to check if user is authenticated and is admin
async function requireAdmin(c: any) {
  const auth = getAuth(c);


  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const userId = auth.sessionClaims?.sub || auth.userId;

  // Fetch user metadata from Clerk API
  try {
    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
      headers: {
        'Authorization': `Bearer ${clerkSecretKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error("Failed to fetch user from Clerk:", await response.text());
      return c.json({ error: "Failed to verify user permissions" }, 500);
    }

    const user = await response.json();

    const isAdmin = user.public_metadata?.isAdmin === true;

    if (!isAdmin) {
      return c.json({ error: "Forbidden - Admin access required" }, 403);
    }

    return null; // User is authenticated and is admin
  } catch (error) {
    console.error("Error checking admin status:", error);
    return c.json({ error: "Failed to verify user permissions" }, 500);
  }
}

const DROPLET_IP = Deno.env.get("DROPLET_IP") || "";

// Validate that a parameter only contains safe characters
// Allows alphanumeric, hyphens, dots, and underscores (e.g. "nick-testing-01", "1.9.1")
function isSafeParam(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value) && value.length <= 100;
}

// Get indiviudal server's info for the cards
async function getServerInfo(serverId: string) {
  const response = await fetch("https://central.fastr-analytics.org/servers.json");
  const servers = await response.json();
  return servers.find((s: any) => s.id === serverId);
}

app.get("/", (c) => c.text("Admin Website Backend is running"));

// pull docker image on main droplet
app.post("/api/docker/pull/:version", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const versionToPull = c.req.param("version");

    if (!isSafeParam(versionToPull)) {
        return c.json({ error: "Invalid version format" }, 400);
    }

    const command = `docker pull timroberton/comb:wb-fastr-server-v${versionToPull}`;

    if(!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

    try{
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});
 
// Restart individual server - PROTECTED
app.post("/api/servers/:id/restart", async (c) => {
    // Check authentication and admin status
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");

    if (!isSafeParam(serverId)) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    const server = await getServerInfo(serverId);

    if(!server || !server.id) {
        return c.json({ error: "Server not found" }, 404);
    }

    const command = `wb restart ${serverId}`;

    console.log(command);

    if(!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

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

// Restart bulk serveres - PROTECTED
app.post("/api/servers/bulk-restart", async (c) => {
    // Check auth
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ ids: string[] }>();
    const ids: string[] = body.ids;

    const prefix = "wb restart ";
    const command = prefix + ids.join(" ");

    if (!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

    try {
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json({ error: String(error)}, 500);
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
    // Check authentication and admin status
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");

    if (!isSafeParam(serverId)) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    try{
       const response = await fetch(`https://${serverId}.fastr-analytics.org/health_check`);
       const data = await response.json();
       return c.json(data);
    }catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});
// update server version (need to run restart api after) - PROTECTED
app.post("/api/servers/:id/update", async (c) => {
    // Check authentication and admin status
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");
    const { version } = await c.req.json();

    if (!isSafeParam(serverId) || !isSafeParam(version)) {
        return c.json({ error: "Invalid server ID or version format" }, 400);
    }

    const server = await getServerInfo(serverId);

    if(!server || !server.id) {
        return c.json({ error: "Server not found" }, 404);
    }

    const command = `wb c update ${serverId} --server ${version}`

    console.log(command);

    if(!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

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
});

// buld update server versions (need to run bulk restart api after) - PROTECTED
app.post("/api/servers/bulk-update", async (c) => {
    // check auth
    const authError = await requireAdmin(c);
    if (authError) return authError;

    // get body with the server ids
    const body = await c.req.json<{ ids: string[], version: string }>();
    const ids: string[] = body.ids;
    const version: string = body.version;

    const prefix = "wb c update "
    const suffix = "--server " + version;
    const command = prefix + ids.join(" ") + " " + suffix;

    if(!isCommandAllowed(command)) {
        return c.json({ error: "command not allowed" }, 403);
    }

    // update servers
    try {
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message:result.stdout,
            error: result.stderr,
        });
    } catch (error) {
        return c.json ({ error: String(error) }, 500);
    }
});

// get all of the versions that we are able to update to - PROTECTED
app.get("/api/versions", async (c) => {
    // Check authentication and admin status
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const command = `docker images --format "{{.Tag}}" timroberton/comb`;

    if(!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

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

        // Sort by semantic version (newest first)
        const sortedTags = tags.sort((a, b) => {
            const aParts = a.split('.').map(Number);
            const bParts = b.split('.').map(Number);

            for (let i = 0; i < 3; i++) {
                if (bParts[i] !== aParts[i]) {
                    return bParts[i] - aParts[i];
                }
            }
            return 0;
        });

        return c.json({ versions: sortedTags });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// get servers docker logs - PROTECTED
app.get("/api/servers/:id/logs", async (c) =>{
    // Check authentication and admin status
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");

    if (!isSafeParam(serverId)) {
        return c.json({ success: false, logs: '', error: "Invalid server ID" });
    }

    const command = `docker logs ${serverId}`;

    if(!isCommandAllowed(command)) {
        return c.json({ success: false, logs: '', error: "Command not allowed" });
    }

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

// backup tables from main app onto admin volume
app.post("/api/servers/:id/backup/:name?", async (c) =>{
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");
    const backupName = c.req.param("name") || "";

    try {
        // Run backup script locally (not via SSH)
        const command = new Deno.Command("/root/backup-scripts/fastr-backup.sh", {
            args: [serverId, backupName],
            stdout: "piped",
            stderr: "piped",
        });

        const process = command.spawn();
        const { code, stdout, stderr } = await process.output();

        const stdoutText = new TextDecoder().decode(stdout);
        const stderrText = new TextDecoder().decode(stderr);

        if (code === 0) {
            return c.json({ success: true, logs: stdoutText, error: '' });
        } else {
            return c.json({ success: false, logs: '', error: stderrText });
        }
    } catch (error) {
        return c.json({ success: false, logs: '', error: String(error) });
    }
});

// delete snapshot by id
app.delete("/api/server/snapshot/:id", async (c) =>{
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const volumeId = Deno.env.get("VOLUME_ID");

    const snapshotId = c.req.param("id");

    if(!doToken || !volumeId) {
        return c.json({
            success: false,
            error: "Digital Ocean API token or Volume ID not found",
        });
    }

    try {
        const response = await fetch(`https://api.digitalocean.com/v2/snapshots/${snapshotId}`, {
            method: "DELETE",
            headers: {
                "Authorization": `Bearer ${doToken}`,
                "Content-Type": "application/json",
            },
        });

        if (response.status === 204) {
            // 204 No Content means successful deletion
            return c.json({
                success: true,
                message: `Snapshot deleted successfully`
            });
        } else if (!response.ok) {
            const result = await response.json();
            return c.json({
                success: false,
                error: result.message || "Failed to delete snapshot"
            });
        }
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// take snapshot of main droplet volume
app.post("/api/server/snapshot", async (c) =>{
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const volumeId = Deno.env.get("VOLUME_ID");

    if(!doToken || !volumeId) {
        return c.json({
            success: false,
            error: "Digital Ocean API token or Volume ID not found",
        });
    }

    try{
        // Generate snpashot name with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const snapshotName = `${volumeId}-snapshot-${timestamp}`;

        // Create volume snapshot
        const response = await fetch(`https://api.digitalocean.com/v2/volumes/${volumeId}/snapshots`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${doToken}`,
            },
            body: JSON.stringify({
                name: snapshotName,
                description: `Snapshot for ${volumeId} created via admin dashboard`,
            }),
        });

        const result = await response.json();

        if (response.ok) {
            return c.json({
                success: true,
                snapshot: result.snapshot,
                message: `Snapshot ${snapshotName} created successfully`
            });
        } else {
            return c.json({
                success: false,
                error: result.message || "Failed to create snapshot"
            });
        }
    } catch (error) {
        return c.json({ success: false, error: String(error) });
    }
});

// Get the list of snapshots for the volume
app.get("/api/servers/snapshots", async(c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    try {
        const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
        const volumeId = Deno.env.get("VOLUME_ID");

        if(!doToken || !volumeId) {
            return c.json({
               success: false,
               error: 'Missing DigitalOcean credentials'
            }, 500);
        }

        // Fetch volume snapshots
        const response = await fetch(
            `https://api.digitalocean.com/v2/volumes/${volumeId}/snapshots`,
            {
                headers: {
                    'Authorization': `Bearer ${doToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            return c.json({ 
                success: false, 
                error: `DigitalOcean API error: ${errorText}` 
            }, response.status);
        }

        const data = await response.json();
        return c.json({
            success: true,
            snapshots: data.snapshots || []
        });

    } catch (error) {
        console.error('Error fetching volue snapshots:', error);
        return c.json({
            success: false,
            error: 'Failed to fetch snpashots'
        }, 500);
    }
});

// List all backups for a server
app.get("/api/servers/:id/backups", async (c) =>{
    const secretKey = c.req.header("status-api-key");
    if(secretKey !== Deno.env.get("STATUS_API_KEY")){
        const authError = await requireAdmin(c);
        if (authError) return authError;
    }

    const serverId = c.req.param("id");
    const backupBaseDir = `/mnt/fastr-backups/${serverId}`;

    try{
        // Check if backup directory exists
        let dirInfo;
        try {
            dirInfo = await Deno.stat(backupBaseDir);
        } catch {
            return c.json({ backups: [] });
        }

        if (!dirInfo.isDirectory) {
            return c.json({ backups: [] });
        }

        // Read all backup folders
        const backups = [];
        for await (const entry of Deno.readDir(backupBaseDir)) {
            if (entry.isDirectory) {
                const backupPath = `${backupBaseDir}/${entry.name}`;

                // Try read metadata.json
                let metadata = null;
                try {
                    const metadataText = await Deno.readTextFile(`${backupPath}/metadata.json`);
                    metadata = JSON.parse(metadataText);
                } catch {
                    // If metadata doesn't exist, create basic info from folder name
                    metadata = {
                        timestamp: entry.name,
                        backup_date: entry.name,
                    };
                }

                // Get folder size, file count, and list all files
                let totalSize = 0;
                let fileCount = 0;
                const files = [];
                try {
                    for await (const file of Deno.readDir(backupPath)) {
                        if (file.isFile) {
                            const fileInfo = await Deno.stat(`${backupPath}/${file.name}`);
                            totalSize += fileInfo.size;
                            fileCount++;

                            // Categorize file type
                            let fileType = 'other';
                            if (file.name === 'main.sql.gz') {
                                fileType = 'main';
                            } else if (file.name === 'metadata.json') {
                                fileType = 'metadata';
                            } else if (file.name === 'backup.log') {
                                fileType = 'log';
                            } else if (file.name.endsWith('.sql.gz')) {
                                fileType = 'project';
                            }

                            files.push({
                                name: file.name,
                                size: fileInfo.size,
                                type: fileType,
                            });
                        }
                    }
                } catch {
                    // Ignore errors reading directory
                }

                backups.push({
                    folder: entry.name,
                    timestamp: metadata.timestamp,
                    backup_date: metadata.backup_date,
                    total_projects: metadata.total_projects || 0,
                    backed_up_projects: metadata.backed_up_projects || 0,
                    size: totalSize,
                    file_count: fileCount,
                    files: files,
                });
            }
        }

        // Sort by timestamp (newest first)
        backups.sort((a,b) => b.timestamp.localeCompare(a.timestamp));

        return c.json({ backups });
    } catch (error){
        console.error(`Error listing backups for ${serverId}:`, error);
        return c.json({ error: String(error) },500);
    }
});

// Download entire backup folder as tar.gz (MUST be before the :file route)
app.get("/api/servers/:id/backups/:folder/download-all", async (c) => {
    const secretKey = c.req.header("status-api-key");
    if(secretKey !== Deno.env.get("STATUS_API_KEY")){
        const authError = await requireAdmin(c);
        if (authError) return authError;
    }

    const serverId = c.req.param("id");
    const folder = c.req.param("folder");

    // Security: Prevent directory traversal
    if (folder.includes("..") || folder.includes("/")) {
        return c.json({ error: "Invalid path" }, 400);
    }

    const backupPath = `/mnt/fastr-backups/${serverId}/${folder}`;

    try {
        // Check if directory exists
        const dirInfo = await Deno.stat(backupPath);
        if (!dirInfo.isDirectory) {
            return c.json({ error: "Backup folder not found" }, 404);
        }

        // Create tar.gz archive using tar command
        const tarFileName = `${serverId}_${folder}.tar.gz`;
        const command = new Deno.Command("tar", {
            args: ["-czf", "-", "-C", backupPath, "."],
            stdout: "piped",
            stderr: "piped",
        });

        const process = command.spawn();
        const { code, stdout, stderr } = await process.output();

        if (code !== 0) {
            const errorText = new TextDecoder().decode(stderr);
            console.error(`Error creating tar archive: ${errorText}`);
            return c.json({ error: "Failed to create archive" }, 500);
        }

        // Return the tar.gz file
        return new Response(stdout, {
            headers: {
                "Content-Type": "application/gzip",
                "Content-Disposition": `attachment; filename="${tarFileName}"`,
            },
        });
    } catch (error) {
        console.error(`Error downloading backup folder:`, error);
        return c.json({ error: "Failed to download backup" }, 500);
    }
});

// Download a specific backup file
app.get("/api/servers/:id/backups/:folder/:file", async (c) => {

    const secretKey = c.req.header("status-api-key");
    if(secretKey !== Deno.env.get("STATUS_API_KEY")){
        const authError = await requireAdmin(c);
        if (authError) return authError;
    }
    

    const serverId = c.req.param("id");
    const folder = c.req.param("folder");
    const file = c.req.param("file");

    // Security: Prevent directory traversal
    if (folder.includes("..") || file.includes("..") || folder.includes("/") || file.includes("/")) {
        return c.json({ error: "Invalid path" }, 400);
    }

    const filePath = `/mnt/fastr-backups/${serverId}/${folder}/${file}`;

    try {
        //check if file exists
        const fileInfo = await Deno.stat(filePath);
        if (!fileInfo.isFile) {
            return c.json({ error: "File not found" }, 404);
        }

        // Read the file
        const fileContent = await Deno.readFile(filePath);

        // Determine content type
        let contentType = "application/octet-stream";
        if (file.endsWith(".gz")) {
            contentType = "application/gzip";
        } else if (file.endsWith(".json")) {
            contentType = "application/json";
        } else if (file.endsWith(".log")) {
            contentType = "text/plain";
        }

        // Set appropriate headers for download
        return new Response(fileContent, {
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${file}"`,
                "Content-Length": fileInfo.size.toString(),
            },
        });
    } catch (error) {
        console.error(`Error downloading backup file:`, error);
        return c.json({ error: "File not found" }, 404);
    }
});

// Github api route

// List all modules
app.get("/api/module-definitions", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    try {
        const modules = await github.listModules();
        return c.json({ success: true, data: modules });
    } catch (error) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get specfic defintion.ts file
app.get("/api/module-definitions/:moduleId", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const moduleId = c.req.param("moduleId");

    try {
        const content = await github.getDefinitionFile(moduleId);
        return c.json({ success: true, data: { content } });
    } catch (error) {
        return c.json({ success: false, error: error.message}, 500);
    }
});

// Commit batch changes
app.post("/api/module-definitions/commit", async (c) => {
    const authError = await requireAdmin(c);
    if(authError) return authError;

    const body = await c.req.json();
    const { changes, commitMessage } = body;

    try {
        const result = await github.commitBatchChanges(changes, commitMessage);
        return c.json({ success: true, data:result });
    } catch (error) {
        return c.json({ success: false, error: error.message }, 500);
    }
});


// Proxy user activity from a platform instance
app.get("/api/servers/:id/user_activity", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");
    const email = c.req.query("email") ?? "";

    if (!isSafeParam(serverId)) {
        return c.json({ error: "Invalid server ID" }, 400);
    }

    try {
        const response = await fetch(`https://${serverId}.fastr-analytics.org/user_activity?email=${encodeURIComponent(email)}`);
        const data = await response.json();
        return c.json(data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// users endpoints
app.get("/api/users", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const response = await fetch("https://api.clerk.com/v1/users?limit=500", {
        headers: { Authorization: `Bearer ${clerkSecretKey}` },
    });

    const users = await response.json();
    return c.json(users);
});

// get all sessions for a specific user (paginated)
app.get("/api/users/:userId/sessions", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const userId = c.req.param("userId");
    const since = c.req.query("since");
    const sinceMs = since ? Number(since) : null;
    const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY");
    const limit = 100;

    try {
        const allSessions = [];
        let offset = 0;

        while (true) {
            const response = await fetch(
                `https://api.clerk.com/v1/sessions?user_id=${userId}&limit=${limit}&offset=${offset}`,
                { headers: { Authorization: `Bearer ${clerkSecretKey}` } }
            );

            if (!response.ok) {
                return c.json({ error: "Failed to fetch sessions" }, 502);
            }

            const page = await response.json();

            if (sinceMs) {
                const filtered = page.filter((s: { created_at: number }) => s.created_at >= sinceMs);
                allSessions.push(...filtered);
                // If any session on this page was older than the cutoff, we're done
                if (filtered.length < page.length) break;
            } else {
                allSessions.push(...page);
            }

            if (page.length < limit) break;
            offset += limit;
        }

        return c.json(allSessions);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// ---- Server Locks ----
const LOCKS_FILE = "/mnt/fastr-config/server-locks.json";

async function readLocks(): Promise<string[]> {
  try {
    return JSON.parse(await Deno.readTextFile(LOCKS_FILE));
  } catch {
    return [];
  }
}

async function writeLocks(locks: string[]): Promise<void> {
  await Deno.mkdir("/mnt/fastr-config", { recursive: true });
  await Deno.writeTextFile(LOCKS_FILE, JSON.stringify(locks));
}

app.get("/api/servers/locks", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  return c.json(await readLocks());
});

app.post("/api/servers/:id/lock", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  const id = c.req.param("id");
  if (!isSafeParam(id)) return c.json({ error: "Invalid server id" }, 400);
  const locks = await readLocks();
  if (!locks.includes(id)) {
    locks.push(id);
    await writeLocks(locks);
  }
  return c.json({ locked: true });
});

app.delete("/api/servers/:id/lock", async (c) => {
  const authError = await requireAdmin(c);
  if (authError) return authError;
  const id = c.req.param("id");
  if (!isSafeParam(id)) return c.json({ error: "Invalid server id" }, 400);
  const locks = (await readLocks()).filter(l => l !== id);
  await writeLocks(locks);
  return c.json({ locked: false });
});


// routes to create a new instance


// create record using digitalocean api
app.post("/api/servers/create/record", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ subdomain: string }>();
    const subdomain = body.subdomain;

    if (!isSafeParam(subdomain)) {
        return c.json({ success: false, error: "Invalid subdomain"});
    }

    const doToken = Deno.env.get("DIGITALOCEAN_API_TOKEN");
    const dropletIp = Deno.env.get("DROPLET_IP");

    try{
        const response = await fetch("https://api.digitalocean.com/v2/domains/fastr-analytics.org/records",{
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
            return c.json({ success: false, error: result.message || "Failed to create DNS record" }, response.status);
        }

        return c.json({ success: true, record: result.domain_record });
    } catch (error){
        return c.json({ success: false, error: String(error) }, 500);
    }
    

});

// add server to config
app.post("/api/servers/create/server", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb c add ${serverId}`;

    if(!isCommandAllowed(command)){
        return c.json({ success: false, error: "Invalid command" });
    }

    try{
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// init nginx
app.post("/api/servers/create/nginx", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-nginx ${serverId}`;

    if(!isCommandAllowed(command)){
        return c.json({ success: false, error: "Invalid command" });
    }

    try{
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// init ssl
app.post("/api/servers/create/ssl", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-ssl ${serverId}`;

    if(!isCommandAllowed(command)){
        return c.json({ success: false, error: "Invalid command" });
    }

    try{
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// init dirs
app.post("/api/servers/create/dirs", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json<{ serverId: string }>();
    const serverId = body.serverId;

    const command = `wb init-dirs ${serverId}`;

    if(!isCommandAllowed(command)){
        return c.json({ success: false, error: "Invalid command" });
    }

    try{
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// change label for server
app.post("/api/servers/update/label", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;
    
    const body = await c.req.json<{ serverId: string, newLabel: string }>();
    const serverId = body.serverId; 
    const newLabel = body.newLabel;

    const command = `wb c update ${serverId} --label ${newLabel}`;

    if(!isCommandAllowed(command)){
        return c.json({ success: false, error: "Invalid command" });
    }

    try{
        const result = await executeCommand(DROPLET_IP, command);
        return c.json({
            success: result.success,
            message: result.stdout,
            error: result.stderr
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

const PORT = parseInt(Deno.env.get("PORT") || "3001");
console.log(`🚀 Server running on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, app.fetch);