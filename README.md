# tempybot

## GitHub Pages

- **Project Pages**: [holiber.github.io/tempybot](https://holiber.github.io/tempybot/)
- **Scenario videos**: [holiber.github.io/tempybot/scenarios](https://holiber.github.io/tempybot/scenarios/)
- **StackBlitz WebContainer demos**: [holiber.github.io/tempybot/stackblitz-webcontainer](https://holiber.github.io/tempybot/stackblitz-webcontainer/)

## Usage examples

### Parse agent markdown in a JS project

```js
import { agentTemplateToJson } from "tempybot";

const md = `
# My Agent

## System
You are a helpful assistant.

## Rules
- Be concise.
`;

const definition = agentTemplateToJson(md);
console.log(definition);
```

### CLI: parse a file and print JSON to stdout

```bash
tempybot parse "./docs/agent-examples/python-data-cleaner.agent.md"
```

### CLI: also write JSON to a file

```bash
tempybot parse "./docs/agent-examples/python-data-cleaner.agent.md" --out "./python-data-cleaner.agent.json"
```

If parsing fails, the CLI prints the reason to stderr and exits with a non-zero code.

## Cursor Cloud Agents (OpenAPI + MCP)

- **Spec**: `src/agnet/cloud-agents-openapi.yaml`
- **MCP server (stdio)**: `npm run mcp:cursor-cloud-agents`
- **Docs**: `docs/agnet/mcp-cursor-cloud-agents.md`

