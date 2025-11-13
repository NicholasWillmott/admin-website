// SSH command executor using native Deno
export interface CommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
    code: number;
}

export async function executeCommand(
    host: string,
    command: string,
    privateKeyPath?: string
): Promise<CommandResult> {
    let keyPath = privateKeyPath || Deno.env.get("SSH_KEY_PATH") || "~/.ssh/id_rsa";

    // Expand ~ to home directory
    if (keyPath.startsWith("~")) {
        const home = Deno.env.get("HOME") || "/home/nicho";
        keyPath = keyPath.replace("~", home);
    }

    console.log(`Executing on ${host}: ${command}`);

    // Use native SSH command via Deno
    const sshCommand = new Deno.Command("ssh", {
        args: [
            "-i", keyPath,
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            `root@${host}`,
            command
        ],
        stdout: "piped",
        stderr: "piped",
    });

    const process = sshCommand.spawn();
    const { code, stdout, stderr } = await process.output();

    const stdoutText = new TextDecoder().decode(stdout);
    const stderrText = new TextDecoder().decode(stderr);

    return {
        success: code === 0,
        stdout: stdoutText,
        stderr: stderrText,
        code: code,
    };
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
  /^wb c update [\w-@]+ (?:--label "[\w\s.-]+" |--french (?:true|false) |--ethiopian (?:true|false) |--open-access (?:true|false) |--server [\d.]+ |--admin [\d.]+ |--instance-dir [\w-]+ )*$/,
  /^wb c remove [\w-]+$/,
  /^wb c tag [\w-]+ (?:[\w-]+ ?)+$/,
  /^wb c untag [\w-]+ (?:[\w-]+ ?)+$/,
  /^wb c validate$/,
  /^wb c backup$/,
  /^wb c restore [\w.-]+$/,

  // INITIALIZATION COMMANDS - server infrastructure
  /^wb init-dirs [\w-]+$/,
  /^wb init-nginx [\w-]+$/,
  /^wb init-ssl [\w-]+$/,
  /^wb remove-dirs [\w-]+$/,
  /^wb remove-nginx [\w-]+$/,
  /^wb remove-ssl [\w-]+$/,
  /^wb list-nginx$/,
  /^wb list-ssl$/,

  // DOCKER COMMANDS - container management
  /^wb run (?:[\w-]+|all|@[\w-]+|server=[\d.]+|admin)(?: (?:[\w-]+|@[\w-]+|server=[\d.]+))*$/,
  /^wb start (?:[\w-]+|all|@[\w-]+|server=[\d.]+|admin)(?: (?:[\w-]+|@[\w-]+|server=[\d.]+))*$/,
  /^wb stop (?:[\w-]+|all|@[\w-]+|server=[\d.]+|admin)(?: (?:[\w-]+|@[\w-]+|server=[\d.]+))*$/,
  /^wb restart (?:[\w-]+|all|@[\w-]+|server=[\d.]+|admin)(?: (?:[\w-]+|@[\w-]+|server=[\d.]+))*$/,
  /^wb pull$/,
  /^wb prune$/,

  // OTHER
  /^wb help$/,
  /^docker ps$/,
];

export function isCommandAllowed(command: string): boolean {
    return ALLOWED_COMMANDS.some((pattern) => pattern.test(command))
}