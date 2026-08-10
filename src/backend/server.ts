/// <reference lib="deno.ns" />
import { load } from "@std/dotenv";

// Load .env file at startup before any route modules read env vars
await load({ export: true });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { clerkMiddleware } from "@hono/clerk-auth";

import dockerRouter from "./routes/docker.ts";
import serversRouter from "./routes/servers.ts";
import backupsRouter from "./routes/backups.ts";
import snapshotsRouter from "./routes/snapshots.ts";
import createRouter from "./routes/create.ts";
import removeRouter from "./routes/remove.ts";
import modulesRouter from "./routes/modules.ts";
import usersRouter from "./routes/users.ts";
import volumesRouter from "./routes/volumes.ts";
import emailsRouter from "./routes/emails.ts";
import changelogRouter from "./routes/changelog.ts";
import indicatorsRouter from "./routes/indicators.ts";
import accessLogRouter from "./routes/accessLog.ts";
import adminsRouter from "./routes/admins.ts";
import whatsNewRouter, { startWhatsNewImageSweep } from "./routes/whatsnew.ts";
import oauthMetadataRouter from "./mcp/oauth_metadata.ts";
import { MCP_CORS_HEADERS, mcpHttpHandler } from "./mcp/mcp_endpoint.ts";
const app = new Hono();

// ---- MCP connector + OAuth discovery -----------------------------------
// MUST stay registered ahead of the global cors() and clerkMiddleware()
// below (Hono runs matches in registration order, and a handler that
// responds stops the chain). The discovery documents are what an OAuth
// client reads BEFORE it has credentials, and /mcp authenticates bearer
// tokens itself (mcp/mcp_auth.ts). Neither may pass through the globals:
// the fixed-origin credentials CORS below is wrong for cross-origin token
// clients, and Clerk's handshake redirects break JSON-RPC clients.
app.route("/", oauthMetadataRouter); // /.well-known/*
app.all("/mcp", async (c) => {
  // Preflight answered before auth — browsers never attach Authorization
  // to an OPTIONS preflight, so letting it hit the auth path 401s every
  // browser-origin connector before its real request.
  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }
  const res = await mcpHttpHandler(c.req.raw);
  for (const [k, v] of Object.entries(MCP_CORS_HEADERS)) res.headers.set(k, v);
  return res;
});
// ------------------------------------------------------------------------

app.use("*", cors({
  origin: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://status.fastr-analytics.org",
  ],
  credentials: true,
}));

// UPGRADE LANDMINE: @hono/clerk-auth 3.0.x pins acceptsToken to session
// tokens, so an MCP OAuth bearer token hitting this middleware resolves
// signed-out. v3.1+ switches to acceptsToken:"any", which would let machine
// tokens produce an authenticated getAuth() on ordinary /api routes — before
// upgrading, re-check requireAdmin against a machine token (the platform's
// guard for this is platform/server/middleware/auth.ts:21-34).
app.use("*", clerkMiddleware({
  publishableKey: Deno.env.get("VITE_CLERK_PUBLISHABLE_KEY"),
  secretKey: Deno.env.get("CLERK_SECRET_KEY"),
}));

app.get("/", (c) => c.text("Admin Website Backend is running"));

app.route("/api", dockerRouter);
app.route("/api/servers", serversRouter);
app.route("/api/servers", backupsRouter);
app.route("/api", snapshotsRouter);
app.route("/api/servers", createRouter);
app.route("/api/servers", removeRouter);
app.route("/api/module-definitions", modulesRouter);
app.route("/api/users", usersRouter);
app.route("/api/volumes", volumesRouter);
app.route("/api/emails", emailsRouter);
app.route("/api/changelog", changelogRouter);
app.route("/api/servers", indicatorsRouter);
app.route("/api/access-log", accessLogRouter);
app.route("/api/admins", adminsRouter);
app.route("/api/whats-new", whatsNewRouter);
startWhatsNewImageSweep();
const PORT = parseInt(Deno.env.get("PORT") || "3001");
console.log(`Server running on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, app.fetch);
