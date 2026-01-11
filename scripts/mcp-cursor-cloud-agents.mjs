#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * MCP stdio server wrapper for Cursor Cloud Agents OpenAPI spec.
 *
 * This wrapper is intentionally tiny:
 * - Keeps secrets in env vars (CURSOR_API_KEY) rather than in config/args.
 * - Uses the repo-local dev dependency (via `npx --no-install`).
 */

const ROOT = process.cwd();
const specPath = path.join(ROOT, "src", "agnet", "cloud-agents-openapi.yaml");

const args = [
  "--no-install",
  "openapi-mcp-server",
  "--transport",
  "stdio",
  "--openapi-spec",
  specPath,
  "--api-base-url",
  "https://api.cursor.com",
  "--name",
  "cursor-cloud-agents",
  "--server-version",
  "0.1.0",
];

const apiKey = process.env.CURSOR_API_KEY ?? process.env.CURSOR_CLOUD_API_KEY ?? process.env.CURSORCLOUDAPIKEY;
if (apiKey && apiKey.trim()) {
  args.push("--headers", `Authorization:Bearer ${apiKey.trim()}`);
}

const child = spawn("npx", args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

