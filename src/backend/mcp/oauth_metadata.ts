/// <reference lib="deno.ns" />
import { Hono } from "hono";

// OAuth discovery for the /mcp endpoint (adapted from the FASTR platform's
// server/routes/public/oauth_metadata.ts).
//
// These are the documents an OAuth-capable MCP client (claude.ai custom
// connectors, Claude Desktop) fetches to learn that /mcp is a protected
// resource and WHICH authorization server guards it. They must be reachable
// WITHOUT credentials — they are the thing a client reads *before* it has
// any. server.ts therefore registers this router ahead of the global CORS +
// Clerk middleware.
//
// This backend is only the resource server. Clerk is the authorization
// server: it owns /authorize, /token and (with dynamic client registration
// enabled) /oauth/register. Nothing in this file issues or validates a token;
// the credential is judged in mcp/mcp_auth.ts.

const router = new Hono();

// Clients fetch these cross-origin and they carry no credentials by design,
// so a wildcard origin is correct and safe.
const METADATA_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

// The Clerk Frontend API host is encoded in the publishable key:
// pk_(test|live)_<base64(host + "$")>. Deriving the authorization server URL
// from the key means it can never drift out of sync with the key in use.
function frontendApiUrlFromPublishableKey(
  publishableKey: string,
): string | null {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, "");
  if (encoded === publishableKey || encoded === "") {
    return null;
  }
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const host = decoded.endsWith("$") ? decoded.slice(0, -1) : decoded;
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) {
    return null;
  }
  return `https://${host}`;
}

function authorizationServerUrl(): string | null {
  return frontendApiUrlFromPublishableKey(
    Deno.env.get("VITE_CLERK_PUBLISHABLE_KEY") ?? "",
  );
}

// The public origin, taken from the REQUEST rather than configured: the
// scheme comes from X-Forwarded-Proto because TLS terminates at the droplet's
// nginx — Deno itself sees plain http, and an http:// metadata URL is one an
// OAuth client will refuse. Both headers are caller-influenced, which is
// acceptable because the derived value only ever appears in the response to
// that same caller.
//
// ONE derivation, used by BOTH the metadata document below and the /mcp 401
// challenge (mcp/mcp_endpoint.ts). RFC 9728 ties the pointer to the resource
// identifier, so if these two ever disagreed the discovery would be broken in
// a way neither side could detect alone.
export function publicOriginFromRequest(req: Request): string {
  const url = new URL(req.url);
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwarded === "https" || forwarded === "http") {
    url.protocol = `${forwarded}:`;
  }
  return url.origin;
}

export function mcpResourceMetadataUrl(req: Request): string {
  return `${publicOriginFromRequest(req)}/.well-known/oauth-protected-resource/mcp`;
}

function metadataResponse(body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { "content-type": "application/json", ...METADATA_CORS },
  });
}

function unavailableResponse(): Response {
  // 503, not 404: the endpoint exists, the server just isn't configured to
  // advertise an authorization server. A 404 would tell a client this server
  // does not do OAuth at all, which is a stickier wrong conclusion.
  return new Response(JSON.stringify({ error: "oauth metadata unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json", ...METADATA_CORS },
  });
}

// RFC 9728 §3 — protected resource metadata. Two paths, one document: the
// spec-correct location for the resource https://host/mcp is
// /.well-known/oauth-protected-resource/mcp (what the 401 challenge points
// at); the bare path is served too because clients differ on which they probe.
function protectedResourceMetadata(req: Request): Response {
  const authServer = authorizationServerUrl();
  if (authServer === null) {
    return unavailableResponse();
  }
  return metadataResponse({
    resource: `${publicOriginFromRequest(req)}/mcp`,
    authorization_servers: [authServer],
    bearer_methods_supported: ["header"],
    // Identity only: authorization happens against the user's own isAdmin
    // flag after the token resolves to a user, so there is no
    // connector-specific scope to grant.
    scopes_supported: ["profile", "email"],
  });
}

for (const path of [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]) {
  router.options(path, () => new Response(null, { status: 204, headers: METADATA_CORS }));
  router.get(path, (c) => protectedResourceMetadata(c.req.raw));
}

// RFC 8414 — authorization server metadata, proxied from Clerk. A client that
// predates RFC 9728 goes straight to
// <resource-origin>/.well-known/oauth-authorization-server; serving Clerk's
// own document there keeps those clients working. The body is returned
// VERBATIM, so `issuer` says clerk.<domain> while the document was fetched
// from this origin — deliberate: the endpoints must point at Clerk (they are
// Clerk's), and rewriting `issuer` would break the token exchange. Clients
// strict enough to reject the mismatch are exactly the modern ones that use
// the RFC 9728 document above instead.
const AS_METADATA_TTL_MS = 10 * 60 * 1000;
let asMetadataCache: { body: string; fetchedAt: number } | null = null;

async function authorizationServerMetadata(): Promise<Response> {
  const authServer = authorizationServerUrl();
  if (authServer === null) {
    return unavailableResponse();
  }
  if (
    asMetadataCache !== null &&
    Date.now() - asMetadataCache.fetchedAt < AS_METADATA_TTL_MS
  ) {
    return new Response(asMetadataCache.body, {
      status: 200,
      headers: { "content-type": "application/json", ...METADATA_CORS },
    });
  }
  let body: string;
  try {
    const upstream = await fetch(
      `${authServer}/.well-known/oauth-authorization-server`,
    );
    if (!upstream.ok) {
      return unavailableResponse();
    }
    body = await upstream.text();
  } catch (error) {
    console.error("Could not fetch Clerk authorization server metadata:", error);
    return unavailableResponse();
  }
  asMetadataCache = { body, fetchedAt: Date.now() };
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", ...METADATA_CORS },
  });
}

router.options(
  "/.well-known/oauth-authorization-server",
  () => new Response(null, { status: 204, headers: METADATA_CORS }),
);
router.get(
  "/.well-known/oauth-authorization-server",
  () => authorizationServerMetadata(),
);

export default router;
