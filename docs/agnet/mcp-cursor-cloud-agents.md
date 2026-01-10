# Cursor Cloud Agents MCP (OpenAPI)

This repo includes an OpenAPI spec for **Cursor Cloud Agents** at:

- `src/agnet/cloud-agents-openapi.yaml`

The easiest way to use it is via an **MCP server** that exposes the OpenAPI operations as tools.

## Install Cursor CLI (optional)

If you want the Cursor CLI locally, follow Cursor’s official install instructions. For reference, Cursor also provides:

```bash
curl https://cursor.com/install -fsS | bash
```

## Run the MCP server (stdio)

1. Install dependencies:

```bash
npm install
```

2. Export an API key (create one in Cursor Dashboard):

```bash
export CURSOR_API_KEY="your_api_key_here"
```

3. Start the MCP server:

```bash
npm run mcp:cursor-cloud-agents
```

This uses `scripts/mcp-cursor-cloud-agents.mjs` which:

- Starts `openapi-mcp-server` over **stdio**
- Adds an `Authorization: Bearer <CURSOR_API_KEY>` header if `CURSOR_API_KEY` is set

## Use it in Cursor “MCP Studio” / UI

Add a new MCP server that runs from the repo root:

- **Command**: `node`
- **Args**: `scripts/mcp-cursor-cloud-agents.mjs`
- **Env**:
  - `CURSOR_API_KEY`: your Cursor API key

Once added, the tools should appear for the operations defined in the OpenAPI spec.

