/// <reference lib="deno.ns" />
import { createClerkClient } from "@clerk/backend";
import { getIsAdmin, getUserEmail } from "../lib/auth.ts";

// The /mcp credential seam. MCP clients (claude.ai connectors, Claude
// Desktop/Code) carry no cookies — identity is resolved from the
// Authorization header alone, as a Clerk-issued OAuth access token.
// Clerk is the authorization server (it owns /authorize, /token and dynamic
// client registration); this backend only VERIFIES tokens and maps them to a
// Clerk user, then authorizes with the exact same isAdmin check the website
// uses (lib/auth.ts).
//
// Contract (mirrors platform/server/headless_auth.ts, and the distinction is
// load-bearing for OAuth clients):
//   null        -> not a valid credential        -> caller answers 401
//   "not_admin" -> valid credential, not allowed -> caller answers 403
//   THROW       -> backend could not judge it    -> caller answers 503
// A 401 tells a client its token is bad, so it discards the grant and forces
// the user back through consent. That must only happen for genuinely bad
// tokens — never for a Clerk outage (503) or a non-admin user (403).

export type McpPrincipal = { userId: string; email: string };

export const BEARER_PREFIX = "Bearer ";

// Only reasons that unambiguously mean "this credential is bad" map to null.
// Clerk folds "secret key wrong" and "network down" into the same signed-out
// state, so the allowlist runs in the negative direction: anything not listed
// throws (-> 503) rather than making a client discard a good grant.
//   token-invalid       — Clerk answered 404: unknown, expired, or revoked
//   token-type-mismatch — a Bearer value that isn't an OAuth access token at
//                         all (rejected locally on the prefix, no network)
// KNOWN HAZARD (unresolved on platform too): if Clerk issues JWT access
// tokens to dynamically-registered clients, an EXPIRED token surfaces as
// "token-verification-failed" -> throw -> 503, so clients retry instead of
// refreshing. If that is observed live, the fix is a local `exp` pre-check on
// JWT-shaped tokens mapping genuine expiry to null — NOT adding that reason
// here, which would misreport a JWKS outage as a bad credential.
const BAD_CREDENTIAL_REASONS: readonly string[] = [
  "token-invalid",
  "token-type-mismatch",
];

// token -> userId, positive entries only, 30s TTL, LRU capped. Load-bearing:
// serving is stateless so EVERY tool call re-presents the credential; without
// this each call costs a Clerk verification round trip. Failures are never
// cached — a bad token must not occupy a slot, and re-asking Clerk about a
// revoked token is exactly the behaviour we want. getIsAdmin/getUserEmail add
// their own 60s caches, so revocation (of the grant or the admin flag)
// applies within ~60s.
const TOKEN_TTL_MS = 30_000;
const TOKEN_CACHE_CAP = 200;
const tokenUserIds = new Map<string, { userId: string; resolvedAt: number }>();

function cachedUserId(token: string): string | null {
  const entry = tokenUserIds.get(token);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt > TOKEN_TTL_MS) {
    tokenUserIds.delete(token);
    return null;
  }
  // LRU refresh: re-insert so Map iteration order tracks recency
  tokenUserIds.delete(token);
  tokenUserIds.set(token, entry);
  return entry.userId;
}

function cacheUserId(token: string, userId: string): void {
  tokenUserIds.set(token, { userId, resolvedAt: Date.now() });
  while (tokenUserIds.size > TOKEN_CACHE_CAP) {
    const oldest = tokenUserIds.keys().next().value;
    if (oldest === undefined) break;
    tokenUserIds.delete(oldest);
  }
}

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerkClient(): ReturnType<typeof createClerkClient> {
  if (clerkClient === null) {
    const secretKey = Deno.env.get("CLERK_SECRET_KEY");
    const publishableKey = Deno.env.get("VITE_CLERK_PUBLISHABLE_KEY");
    if (!secretKey || !publishableKey) {
      // Throw, never return null: a missing key means we CANNOT judge the
      // credential, which is a 503, not "your token is bad"
      throw new Error("Clerk keys not configured — cannot verify OAuth tokens");
    }
    clerkClient = createClerkClient({
      secretKey,
      publishableKey,
      // No outbound analytics request on the auth path of every tool call
      telemetry: { disabled: true },
    });
  }
  return clerkClient;
}

export async function resolveMcpAdmin(
  authorizationHeader: string | null,
): Promise<McpPrincipal | "not_admin" | null> {
  // DELIBERATELY no env-var escape hatch here. There was one (MCP_AUTH_BYPASS)
  // for local probe runs; it was removed because `build` rsyncs src/backend/.env
  // to the droplet wholesale, so a var added for a debugging session ships to
  // production — where it would return a principal before the token is read,
  // exposing every tool to unauthenticated callers. Verifying a Clerk OAuth
  // token below is the only way in. To exercise /mcp locally, use a real token.
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = authorizationHeader.slice(BEARER_PREFIX.length);

  let userId = cachedUserId(token);
  if (!userId) {
    // authenticateRequest reads ONLY the Authorization header on the
    // machine-token path, so a synthesized Request is a complete input
    const probe = new Request("https://mcp.invalid/", {
      headers: { Authorization: authorizationHeader },
    });
    const requestState = await getClerkClient().authenticateRequest(probe, {
      acceptsToken: "oauth_token",
    });
    const auth = requestState.toAuth();
    if (!auth?.isAuthenticated) {
      const reason = requestState.reason ?? "";
      if (BAD_CREDENTIAL_REASONS.includes(reason)) return null;
      throw new Error(
        `Could not verify OAuth access token (reason: ${reason || "unknown"})`,
      );
    }
    const verifiedUserId = (auth as { userId?: string | null }).userId;
    if (!verifiedUserId) {
      throw new Error("Verified OAuth access token carried no userId");
    }
    userId = verifiedUserId;
    cacheUserId(token, userId);
  }

  // Authorization = the EXACT check the website uses, via the same cached
  // helper. A Clerk failure inside it throws -> 503, not a denial.
  if (!(await getIsAdmin(userId))) {
    return "not_admin";
  }
  const email = await getUserEmail(userId);
  if (!email) {
    // A Clerk user with no primary email can't be identified — treat as a
    // bad credential, not a backend outage
    return null;
  }
  return { userId, email };
}
