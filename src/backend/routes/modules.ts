import { Hono } from "hono";
import { requireAdmin } from "../lib/auth.ts";
import * as github from "../viz_editor/github.ts";

const router = new Hono();

// List all module definitions
router.get("/", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    try {
        const modules = await github.listModules();
        return c.json({ success: true, data: modules });
    } catch (error) {
        return c.json({ success: false, error: error.message }, 500);
    }
});

// Get a specific module definition file
router.get("/:moduleId", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const moduleId = c.req.param("moduleId");

    try {
        const content = await github.getDefinitionFile(moduleId);
        return c.json({ success: true, data: { content } });
    } catch (error) {
        return c.json({ success: false, error: error.message }, 500);
    }
});

// Commit batch changes to module definitions
router.post("/commit", async (c) => {
    const authError = await requireAdmin(c);
    if (authError) return authError;

    const body = await c.req.json();
    const { changes, commitMessage } = body;

    try {
        const result = await github.commitBatchChanges(changes, commitMessage);
        return c.json({ success: true, data: result });
    } catch (error) {
        return c.json({ success: false, error: error.message }, 500);
    }
});

export default router;
