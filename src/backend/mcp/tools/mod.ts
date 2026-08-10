/// <reference lib="deno.ns" />
import { McpServer } from "@modelcontextprotocol/server";
import { registerFleetTools } from "./fleet.ts";
import { registerUsageTools } from "./usage.ts";
import { registerUserTools } from "./users.ts";
import { registerContentTools } from "./content.ts";

// One fresh McpServer per HTTP request (createMcpHandler's factory model —
// serving is stateless in both protocol eras). Registering the 16 tools per
// request is negligible; auth has already happened at the /mcp door by the
// time this runs.
export function buildAdminMcpServer(instructions: string): McpServer {
  const server = new McpServer(
    { name: "fastr-admin", version: "1.0.0" },
    { instructions },
  );
  registerFleetTools(server);
  registerUsageTools(server);
  registerUserTools(server);
  registerContentTools(server);
  return server;
}
