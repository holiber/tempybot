/**
 * BigBoss MCP configuration (minimal).
 *
 * This repo currently ships an OpenAPI MCP server wrapper for Cursor Cloud Agents:
 * - scripts/mcp-cursor-cloud-agents.mjs
 *
 * Keep additional MCP servers disabled for BigBoss to reduce CI cold-start time.
 */

export default {
  servers: {
    "cursor-cloud-agents": {
      command: "node",
      args: ["scripts/mcp-cursor-cloud-agents.mjs"],
      env: {
        // The wrapper reads CURSOR_API_KEY.
        // In GitHub Actions we also support CURSOR_CLOUD_API_KEY and CURSORCLOUDAPIKEY and map it in run.sh.
        CURSOR_API_KEY: "${CURSOR_API_KEY}",
      },
    },
  },
};

