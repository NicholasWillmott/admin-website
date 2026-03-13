/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";

const router = new Hono();

// Trigger a backup for a server
router.post("/:id/backup/:name?", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const serverId = c.req.param("id");
    const backupName = c.req.param("name") || "";

    try {
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

// List all backups for a server
router.get("/:id/backups", async (c) => {
    const secretKey = c.req.header("status-api-key");
    if (secretKey !== Deno.env.get("STATUS_API_KEY")) {
        const authError = await requireAdmin(c);
        if (authError) return authError;
    }

    const serverId = c.req.param("id");
    const backupBaseDir = `/mnt/fastr-backups/${serverId}`;

    try {
        let dirInfo;
        try {
            dirInfo = await Deno.stat(backupBaseDir);
        } catch {
            return c.json({ backups: [] });
        }

        if (!dirInfo.isDirectory) {
            return c.json({ backups: [] });
        }

        const backups = [];
        for await (const entry of Deno.readDir(backupBaseDir)) {
            if (entry.isDirectory) {
                const backupPath = `${backupBaseDir}/${entry.name}`;

                let metadata = null;
                try {
                    const metadataText = await Deno.readTextFile(`${backupPath}/metadata.json`);
                    metadata = JSON.parse(metadataText);
                } catch {
                    metadata = {
                        timestamp: entry.name,
                        backup_date: entry.name,
                    };
                }

                let totalSize = 0;
                let fileCount = 0;
                const files = [];
                try {
                    for await (const file of Deno.readDir(backupPath)) {
                        if (file.isFile) {
                            const fileInfo = await Deno.stat(`${backupPath}/${file.name}`);
                            totalSize += fileInfo.size;
                            fileCount++;

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

        backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return c.json({ backups });
    } catch (error) {
        console.error(`Error listing backups for ${serverId}:`, error);
        return c.json({ error: String(error) }, 500);
    }
});

// Download entire backup folder as tar.gz (MUST be before the :file route)
router.get("/:id/backups/:folder/download-all", async (c) => {
    const secretKey = c.req.header("status-api-key");
    if (secretKey !== Deno.env.get("STATUS_API_KEY")) {
        const authError = await requireAdmin(c);
        if (authError) return authError;
    }

    const serverId = c.req.param("id");
    const folder = c.req.param("folder");

    if (folder.includes("..") || folder.includes("/")) {
        return c.json({ error: "Invalid path" }, 400);
    }

    const backupPath = `/mnt/fastr-backups/${serverId}/${folder}`;

    try {
        const dirInfo = await Deno.stat(backupPath);
        if (!dirInfo.isDirectory) {
            return c.json({ error: "Backup folder not found" }, 404);
        }

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
router.get("/:id/backups/:folder/:file", async (c) => {
    const secretKey = c.req.header("status-api-key");
    if (secretKey !== Deno.env.get("STATUS_API_KEY")) {
        const authError = await requireAdmin(c);
        if (authError) return authError;
    }

    const serverId = c.req.param("id");
    const folder = c.req.param("folder");
    const file = c.req.param("file");

    if (folder.includes("..") || file.includes("..") || folder.includes("/") || file.includes("/")) {
        return c.json({ error: "Invalid path" }, 400);
    }

    const filePath = `/mnt/fastr-backups/${serverId}/${folder}/${file}`;

    try {
        const fileInfo = await Deno.stat(filePath);
        if (!fileInfo.isFile) {
            return c.json({ error: "File not found" }, 404);
        }

        const fileContent = await Deno.readFile(filePath);

        let contentType = "application/octet-stream";
        if (file.endsWith(".gz")) {
            contentType = "application/gzip";
        } else if (file.endsWith(".json")) {
            contentType = "application/json";
        } else if (file.endsWith(".log")) {
            contentType = "text/plain";
        }

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

export default router;
