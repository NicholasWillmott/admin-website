import { Octokit } from "@octokit/rest";

const REPO_OWNER = "FASTR-Analytics";
const REPO_NAME = "modules";

let _octokit: Octokit | null = null;
function getOctokit(): Octokit {
    if (!_octokit) {
        _octokit = new Octokit({ auth: Deno.env.get("GITHUB_TOKEN") });
    }
    return _octokit;
}

export interface ModuleInfo {
    moduleId: string;
    version: string;
    label: string;
    vizPresetsCount: number;
    filename: string;
}

export interface FileChange {
    moduleId: string;
    newContent: string;
}

// Module filename mapping (folder/filename format for new per-module folder structure)
const MODULE_FILES: Record<string, string> = {
    "m001": "m001/m001_module_data_quality_assessment.ts",
    "m002": "m002/m002_module_data_quality_adjustments.ts",
    "m003": "m003/m003_module_service_utilization.ts",
    "m004": "m004/m004_module_coverage_estimates.ts",
    "m005": "m005/m005_module_coverage_estimates_part1.ts",
    "m006": "m006/m006_module_coverage_estimates_part2.ts",
};

// Helper to get file by exact name
async function getDefinitionFileByName(filename: string): Promise<string> {
    const { data } = await getOctokit().rest.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: filename,
    });

    if ("content" in data) {
        const binary = atob(data.content);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }
    throw new Error("File not found");
}

// List all module files from GitHub
export async function listModules(): Promise<ModuleInfo[]> {
    const { data: rootData } = await getOctokit().rest.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: "",
    });

    if (!Array.isArray(rootData)) {
        throw new Error("Expected directory listing");
    }

    // Filter for module folders (m001, m002, ...)
    const moduleFolders = rootData.filter(
        (entry) => entry.type === "dir" && /^m\d{3}$/.test(entry.name)
    );

    // For each folder, find the .ts file inside and extract metadata
    const modules = await Promise.all(
        moduleFolders.map(async (folder) => {
            const moduleId = folder.name;

            const { data: folderData } = await getOctokit().rest.repos.getContent({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                path: moduleId,
            });

            if (!Array.isArray(folderData)) {
                throw new Error(`Expected directory listing for ${moduleId}`);
            }

            const tsFile = folderData.find((f) => f.name.endsWith(".ts"));
            if (!tsFile) {
                throw new Error(`No .ts file found in folder ${moduleId}`);
            }

            const content = await getDefinitionFileByName(`${moduleId}/${tsFile.name}`);

            // Parse the file to extract label and count vizPresets
            const labelMatch = content.match(/label:\s*{[^}]*en:\s*"([^"]+)"/);
            const vizPresetsMatches = content.match(/vizPresets:\s*\[/g);

            return {
                moduleId,
                version: "1.0.0",
                label: labelMatch ? labelMatch[1] : moduleId,
                vizPresetsCount: vizPresetsMatches ? vizPresetsMatches.length : 0,
                filename: tsFile.name,
            };
        })
    );

    return modules;
}

// Get content of a specific module file
export async function getDefinitionFile(moduleId: string): Promise<string> {
    const filename = MODULE_FILES[moduleId];

    if (!filename) {
        throw new Error(`Unknown module ID: ${moduleId}`);
    }

    return getDefinitionFileByName(filename);
}

// Commit multiple file changes in a single commit
export async function commitBatchChanges(
    changes: FileChange[],
    commitMessage: string
): Promise<{ success: boolean; commitSha?: string }> {
    // Get the latest commit SHA on main branch
    const { data: refData } = await getOctokit().rest.git.getRef({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        ref: "heads/main",
    });
    const latestCommitSha = refData.object.sha;

    // Get the tree SHA from that commit
    const { data: commitData } = await getOctokit().rest.git.getCommit({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitData.tree.sha;

    // Create blobs for each changed file
    const tree = await Promise.all(
        changes.map(async (change) => {
            const filename = MODULE_FILES[change.moduleId];

            if (!filename) {
                throw new Error(`Unknown module ID: ${change.moduleId}`);
            }

            const { data: blob } = await getOctokit().rest.git.createBlob({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                content: btoa(String.fromCharCode(...new TextEncoder().encode(change.newContent))),
                encoding: "base64",
            });

            return {
                path: filename, // e.g., "m001_module_data_quality_assessment.ts"
                mode: "100644" as const,
                type: "blob" as const,
                sha: blob.sha,
            };
        })
    );

    // Create new tree
    const { data: newTree } = await getOctokit().rest.git.createTree({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        base_tree: baseTreeSha,
        tree,
    });

    // Create commit
    const { data: newCommit } = await getOctokit().rest.git.createCommit({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        message: commitMessage,
        tree: newTree.sha,
        parents: [latestCommitSha],
    });

    // Update main branch reference
    await getOctokit().rest.git.updateRef({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        ref: "heads/main",
        sha: newCommit.sha,
    });

    return { success: true, commitSha: newCommit.sha };
}
