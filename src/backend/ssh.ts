// SSH command executor using native Deno with connection multiplexing
export interface CommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
    code: number;
    /** True when the command was killed by our own timeout rather than exiting on its own. */
    timedOut?: boolean;
}

// Exit code for a command the allowlist refused. 126 is the shell's conventional
// "found but not executable" — distinct from any code a real wb/docker run returns.
export const COMMAND_NOT_ALLOWED_CODE = 126;

// Default ceiling for a single SSH command. Generous because the slowest legitimate
// operations are genuinely slow: `wb restart all` cycles instances sequentially and
// `wb init-ssl` waits on certbot. The point is to bound a wedged connection, not to
// police normal runtimes — fast read-only commands pass a much shorter timeout.
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

// Short timeout for read-only commands (docker logs/ps/inspect, df, du, ls). These
// are on interactive paths, so a hang here is what makes the dashboard stick.
export const READ_TIMEOUT_MS = 60_000;

export interface ExecuteOptions {
    /** Kill the ssh child after this many ms. Defaults to DEFAULT_TIMEOUT_MS. */
    timeoutMs?: number;
    privateKeyPath?: string;
}

// Get control socket path for SSH multiplexing
function getControlPath(host: string): string {
    const tmpDir = Deno.env.get("TMPDIR") || "/tmp";
    // Use sanitized host name for the socket path
    const sanitizedHost = host.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `${tmpDir}/ssh-control-${sanitizedHost}`;
}

export async function executeCommand(
    host: string,
    command: string,
    opts: ExecuteOptions = {},
): Promise<CommandResult> {
    // The allowlist is enforced HERE rather than at each call site. It used to be the
    // caller's job, which meant ~20 places had to remember it and a couple didn't —
    // safety that depends on a convention isn't a boundary. Nothing reaches the remote
    // shell without passing this check.
    if (!isCommandAllowed(command)) {
        console.error(`BLOCKED (not in allowlist) on ${host}: ${command}`);
        return {
            success: false,
            stdout: "",
            stderr: `Command not allowed: ${command}`,
            code: COMMAND_NOT_ALLOWED_CODE,
        };
    }

    const { timeoutMs = DEFAULT_TIMEOUT_MS, privateKeyPath } = opts;

    let keyPath = privateKeyPath || Deno.env.get("SSH_KEY_PATH") || "~/.ssh/id_rsa";

    // Expand ~ to home directory
    if (keyPath.startsWith("~")) {
        const home = Deno.env.get("HOME") || "/home/nicho";
        keyPath = keyPath.replace("~", home);
    }

    console.log(`Executing on ${host}: ${command}`);

    const controlPath = getControlPath(host);

    // Use SSH connection multiplexing to reuse existing connections
    // ControlMaster=auto: Automatically create or reuse master connection
    // ControlPath: Socket file location for connection sharing
    // ControlPersist=10m: Keep connection alive for 10 minutes after last use
    const sshCommand = new Deno.Command("ssh", {
        args: [
            "-i", keyPath,
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ControlMaster=auto",
            "-o", `ControlPath=${controlPath}`,
            "-o", "ControlPersist=10m",
            // 30s x 4 = give up on a silent peer after ~2 minutes. This was
            // CountMax=120 (a full hour), which meant a dead connection held the
            // request open long past any point the answer was still useful.
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=4",
            `root@${host}`,
            command
        ],
        stdout: "piped",
        stderr: "piped",
    });

    const process = sshCommand.spawn();

    // Belt and braces over ServerAlive: those keepalives only fire when the TCP peer
    // goes silent. A connection that stays up while the remote command itself hangs
    // would otherwise wait forever, so kill the child outright at the deadline.
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        try {
            process.kill("SIGKILL");
        } catch {
            // Already exited between the deadline firing and this call — nothing to kill.
        }
    }, timeoutMs);

    try {
        const { code, stdout, stderr } = await process.output();

        const stdoutText = new TextDecoder().decode(stdout);
        const stderrText = new TextDecoder().decode(stderr);

        if (timedOut) {
            console.error(`TIMEOUT after ${timeoutMs}ms on ${host}: ${command}`);
            return {
                success: false,
                stdout: stdoutText,
                stderr: stderrText || `Command timed out after ${timeoutMs}ms`,
                code,
                timedOut: true,
            };
        }

        return {
            success: code === 0,
            stdout: stdoutText,
            stderr: stderrText,
            code: code,
        };
    } finally {
        clearTimeout(timer);
    }
}

// Whitelist of allowed commands to prevent command injection
const ALLOWED_COMMANDS = [
  // CONFIG COMMANDS - servers.json management
  /^wb c list$/,
  /^wb c list --json$/,
  /^wb c list --tag [\w-]+$/,
  /^wb c show [\w-]+$/,
  /^wb c show [\w-]+ --json$/,
  /^wb c add [\w-]+$/,
  /^wb c update (?:[\w-]+ )*[\w-]+ --server [\w.-]+$/,
  /^wb c update [\w-]+ --label "[^"$`\\]+"$/,
  /^wb c update [\w-]+ --french (?:true|false)$/,
  /^wb c update [\w-]+ --portuguese (?:true|false)$/,
  /^wb c update [\w-]+ --ethiopian (?:true|false)$/,
  /^wb c update [\w-]+ --fiscal-year (?:none|july)$/,
  // Letters only (keeps it shell-safe). Not fixed at 3: some instances use a
  // non-ISO3 name, e.g. Somaliland has no ISO3 code. "none" clears the value.
  /^wb c update [\w-]+ --country-iso3 [A-Za-z]{2,24}$/,
  /^wb c update [\w-]+ --open-access (?:true|false)$/,
  /^wb c update [\w-]+ --volume [\w_-]+$/,
  /^wb c remove [\w-]+ --force$/,
  /^wb c tag [\w-]+ (?:[\w-]+ ?)+$/,
  /^wb c untag [\w-]+ (?:[\w-]+ ?)+$/,
  /^wb c validate$/,
  /^wb c backup$/,
  /^wb c restore [\w.-]+$/,

  // INITIALIZATION COMMANDS - server infrastructure
  /^wb init-dirs [\w-]+$/,
  /^wb init-nginx [\w-]+$/,
  /^wb init-ssl [\w-]+$/,
  /^wb remove-dirs [\w-]+ --force$/,
  /^wb remove-nginx [\w-]+$/,
  /^printf "revoke [\w-]+\\n" \| wb remove-ssl [\w-]+$/,
  /^wb list-nginx$/,
  /^wb list-ssl$/,

  // DOCKER COMMANDS - container management
  /^wb run (?:[\w-]+|all|@[\w-]+|server=[\d.]+|admin)(?: (?:[\w-]+|@[\w-]+|server=[\d.]+))*$/,
  /^wb start (?:[\w-]+|all|@[\w-]+|server=[\d.]+|admin)(?: (?:[\w-]+|@[\w-]+|server=[\d.]+))*$/,
  /^wb stop (?:[\w-]+|all|@[\w-]+|server=[\d.]+|admin)(?: (?:[\w-]+|@[\w-]+|server=[\d.]+))*$/,
  /^wb restart (?:[\w-]+|all|@[\w-]+|server=[\d.]+|admin)(?: (?:[\w-]+|@[\w-]+|server=[\d.]+))*$/,
  /^wb run-central [\w-]+$/,
  /^wb pull$/,
  /^wb prune$/,

  // DISK USAGE
  /^ls \/mnt$/,
  /^df -BG$/,
  /^df -BG \/mnt\/[\w_-]+$/,
  /^du -BG --max-depth=1 \/mnt\/[\w_-]+$/,

  // VOLUME RESIZE
  /^resize2fs \/dev\/disk\/by-id\/scsi-0DO_Volume_[\w_-]+$/,

  // OTHER
  /^wb help$/,
  /^docker ps$/,
  /^docker ps --format .+$/,
  /^docker images --format .+ [\w/]+$/,
  // --tail is REQUIRED, deliberately: the bare form returns the container's whole
  // log since start, which the backend buffers entirely and ships to the caller.
  // Leaving it off the allowlist means an unbounded fetch can't be expressed.
  /^docker logs [\w-]+ --tail \d+$/,
  /^docker inspect -f '{{\.Id}} {{\.State\.Status}} {{\.State\.ExitCode}}' [\w-]+$/,
  /^docker pull [\w/:._-]+$/,
];

export function isCommandAllowed(command: string): boolean {
    return ALLOWED_COMMANDS.some((pattern) => pattern.test(command))
}