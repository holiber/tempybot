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

function redactArgs(argv) {
  const out = [...argv];
  for (let i = 0; i < out.length; i++) {
    if (out[i] === "--headers" && typeof out[i + 1] === "string") {
      out[i + 1] = String(out[i + 1]).replace(apiKey ?? "", "<redacted>");
      i++;
    }
  }
  return out;
}

// Test-only / CI-safe: emit args without spawning subprocess.
if (process.env.MCP_DRY_RUN === "1") {
  const hasAuthHeader = args.includes("--headers");
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        cmd: "npx",
        hasAuthHeader,
        args: redactArgs(args),
      },
      null,
      2
    )
  );
  process.exit(0);
}

const child = spawn("npx", args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

