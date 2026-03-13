/// <reference lib="deno.ns" />

// Read at call time (not module load time) so dotenv is guaranteed to have run
export function getDropletIp(): string {
  return Deno.env.get("DROPLET_IP") || "";
}

export function isSafeParam(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value) && value.length <= 100;
}

export async function getServerInfo(serverId: string) {
  const response = await fetch("https://central.fastr-analytics.org/servers.json");
  const servers = await response.json();
  return servers.find((s: any) => s.id === serverId);
}
