# tempybot

## GitHub Pages

- **Project Pages**: [holiber.github.io/tempybot](https://holiber.github.io/tempybot/)
- **Scenario videos**: [holiber.github.io/tempybot/scenarios](https://holiber.github.io/tempybot/scenarios/)

## Usage examples

```bash
# install dependencies
npm ci
```

```bash
# run unit + e2e tests
npm test
```

```bash
# run scenario smoke tests (fast) and list available scenarios
npm run test:scenario:smoke
npm run test:scenario:list
```

```bash
# build the CLI and parse agent definitions
npm run build
node dist/cli.js agent parse "docs/agent-examples/*.agent.md" --stdout
```

