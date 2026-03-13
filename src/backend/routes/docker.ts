/// <reference lib="deno.ns" />
import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import { isSafeParam, getDropletIp } from "../lib/utils.ts";
import { executeCommand, isCommandAllowed } from "../ssh.ts";

const router = new Hono();

// Pull docker image on main droplet
router.post("/docker/pull/:version", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const versionToPull = c.req.param("version");

    if (!isSafeParam(versionToPull)) {
        return c.json({ error: "Invalid version format" }, 400);
    }

    const command = `docker pull timroberton/comb:wb-fastr-server-v${versionToPull}`;

    if (!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
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

// Get available docker image versions
router.get("/versions", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const command = `docker images --format "{{.Tag}}" timroberton/comb`;

    if (!isCommandAllowed(command)) {
        return c.json({ error: "Command not allowed" }, 403);
    }

    try {
        const result = await executeCommand(getDropletIp(), command);

        if (!result.success) {
            return c.json({ error: result.stderr }, 500);
        }

        const tags = result.stdout
            .split('\n')
            .filter(tag => tag.startsWith('wb-fastr-server-v'))
            .map(tag => tag.replace('wb-fastr-server-v', ''));

        const sortedTags = tags.sort((a, b) => {
            const aParts = a.split('.').map(Number);
            const bParts = b.split('.').map(Number);
            for (let i = 0; i < 3; i++) {
                if (bParts[i] !== aParts[i]) return bParts[i] - aParts[i];
            }
            return 0;
        });

        return c.json({ versions: sortedTags });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

export default router;
