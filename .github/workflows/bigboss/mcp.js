/**
 * BigBoss MCP configuration (minimal).
 *
 * This repo currently ships an OpenAPI MCP server wrapper for Cursor Cloud Agents:
 * - scripts/mcp-cursor-cloud-agents.mjs
 *
 * Additional MCP servers:
 * - Playwright MCP: https://github.com/microsoft/playwright-mcp
 * - Chrome DevTools MCP: https://github.com/ChromeDevTools/chrome-devtools-mcp
 *
 * These are installed as repo devDependencies and launched from node_modules
 * to avoid runtime network installs in CI.
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
    playwright: {
      command: "node",
      // Provided by @playwright/mcp (bin: mcp-server-playwright).
      args: ["node_modules/@playwright/mcp/cli.js"],
    },
    "chrome-devtools": {
      command: "node",
      // Provided by chrome-devtools-mcp (bin: chrome-devtools-mcp).
      args: ["node_modules/chrome-devtools-mcp/build/src/index.js"],
    },
  },
};

