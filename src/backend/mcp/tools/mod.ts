/// <reference lib="deno.ns" />
import { McpServer } from "@modelcontextprotocol/server";
import { registerFleetTools } from "./fleet.ts";
import { registerUsageTools } from "./usage.ts";
import { registerUserTools } from "./users.ts";
import { registerContentTools } from "./content.ts";
import { registerCreateServerTool } from "./create_server.ts";

// One fresh McpServer per HTTP request (createMcpHandler's factory model —
// serving is stateless in both protocol eras). Registering the tools per
// request is negligible; auth has already happened at the /mcp door by the
// time this runs.
//
// Every tool here is read-only EXCEPT create_server (create_server.ts), which
// gates execution behind an explicit confirm flag. A new write tool must
// follow the same pattern: no readOnlyHint, preview-by-default, confirm to
// execute.
export function buildAdminMcpServer(instructions: string): McpServer {
  const server = new McpServer(
    { name: "fastr-admin", version: "1.0.0" },
    { instructions },
  );
  registerFleetTools(server);
  registerUsageTools(server);
  registerUserTools(server);
  registerContentTools(server);
  registerCreateServerTool(server);
  return server;
}
