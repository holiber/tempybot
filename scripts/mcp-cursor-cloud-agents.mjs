#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * MCP stdio server wrapper for Cursor Cloud Agents OpenAPI spec.
 *
 * This wrapper is intentionally tiny:
 * - Keeps secrets in env vars rather than in config/args.
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

function readEnvAny(names) {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

const apiKey = readEnvAny(["CURSOR_API_KEY", "CURSOR_CLOUD_API_KEY", "CURSORCLOUDAPIKEY"]);
if (apiKey && apiKey.trim()) {
  args.push("--headers", `Authorization: Bearer ${apiKey.trim()}`);
}

const child = spawn("npx", args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

