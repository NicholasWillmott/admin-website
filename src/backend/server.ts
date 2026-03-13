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

const app = new Hono();

app.use("*", cors({
  origin: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://status.fastr-analytics.org",
    "http://status.fastr-analytics.org",
  ],
  credentials: true,
}));

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

const PORT = parseInt(Deno.env.get("PORT") || "3001");
console.log(`Server running on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, app.fetch);
