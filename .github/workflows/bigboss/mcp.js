/**
 * BigBoss MCP configuration (minimal).
 *
 * This repo currently ships an OpenAPI MCP server wrapper for Cursor Cloud Agents:
 * - scripts/mcp-cursor-cloud-agents.mjs
 *
 * Playwright/Chrome DevTools MCP are intentionally left as placeholders until we
 * decide which exact MCP servers/packages we want to standardize on.
 */

export default {
  servers: {
    "cursor-cloud-agents": {
      command: "node",
      args: ["scripts/mcp-cursor-cloud-agents.mjs"],
      env: {
        // The wrapper reads CURSOR_API_KEY.
        // In GitHub Actions we also support CURSOR_CLOUD_API_KEY and map it in run.sh.
        CURSOR_API_KEY: "${CURSOR_API_KEY}",
      },
    },
  },
};

