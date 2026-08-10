/// <reference lib="deno.ns" />
import { createMcpHandler } from "@modelcontextprotocol/server";
import { resolveMcpAdmin } from "./mcp_auth.ts";
import { buildAdminMcpServer } from "./tools/mod.ts";
import { INSTRUCTIONS } from "./instructions.ts";
import { mcpResourceMetadataUrl } from "./oauth_metadata.ts";

// The /mcp door. Auth happens HERE, once per HTTP request — the SDK handler
// performs no auth of its own. Because serving is stateless in both protocol
// eras (see below), every tool call is its own HTTP POST, so this check runs
// on every dispatch by construction; no session outlives it.

// CORS for /mcp: wildcard origin with NO Allow-Credentials — auth is
// bearer-token only, no ambient cookies, so any origin is safe (and
// wildcard + credentials is an invalid combination anyway). Mcp-Session-Id
// is exposed for browser clients even though stateless serving never issues
// one — harmless, and correct if sessions ever appear.
export const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, Last-Event-ID, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
  // Belt-and-braces for the droplet's nginx: streamable-HTTP responses can be
  // SSE, and buffered SSE looks like a hung connector
  "X-Accel-Buffering": "no",
};

// legacy: 'stateless' (the SDK default) serves 2025-era clients per-request
// with no sessions. Legacy sessions exist ONLY so server->client requests
// (elicitation — write-confirmation prompts) can be correlated across POSTs;
// a read-only connector never elicits, so stateless is fully sufficient and
// the whole session/core-cache layer the platform carries is unnecessary
// here.
const handler = createMcpHandler(() => buildAdminMcpServer(INSTRUCTIONS), {
  onerror: (error) => console.error("[mcp]", error),
});

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export async function mcpHttpHandler(req: Request): Promise<Response> {
  let principal;
  try {
    principal = await resolveMcpAdmin(req.headers.get("Authorization"));
  } catch (error) {
    // Backend couldn't judge the credential (Clerk down, keys missing):
    // 503 so the client retries, NEVER 401 — a 401 makes an OAuth client
    // discard a perfectly good grant and loop the user through consent.
    console.error("[mcp] auth backend failure:", error);
    return jsonResponse(503, { error: "authentication unavailable" });
  }
  if (principal === null) {
    // RFC 9728 §5.1 challenge — the pointer claude.ai follows to discover
    // the Clerk consent flow. Must agree with the discovery document, which
    // is why both derive the URL from mcpResourceMetadataUrl.
    return jsonResponse(401, { error: "unauthorized" }, {
      "WWW-Authenticate": `Bearer resource_metadata="${mcpResourceMetadataUrl(req)}"`,
    });
  }
  if (principal === "not_admin") {
    // Valid credential, unauthorized user: 403, NOT 401 — terminal denial
    // the client surfaces to the user instead of retrying consent forever.
    return jsonResponse(403, {
      error: "Forbidden - this connector requires admin access",
    });
  }
  return await handler.fetch(req, {
    authInfo: {
      token: "",
      clientId: principal.email,
      scopes: [],
      extra: { principal },
    },
  });
}
