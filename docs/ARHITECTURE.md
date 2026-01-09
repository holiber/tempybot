# Architecture

Project layout (repository root):

```text
/                               # Repository root
├─ .github/workflows/            # CI workflows (tests, GitHub Pages)
│  ├─ tests.yml                  # Runs unit/e2e/scenario suites in CI
│  ├─ static.yml                 # Publishes GitHub Pages static site
│  ├─ pages-scenarios.yml        # Publishes scenario pages/artifacts to Pages
│  └─ scenario-userlike-comment.yml # Posts PR comments for userlike scenario runs
├─ docs/                         # Documentation and example inputs/outputs
│  ├─ ARHITECTURE.md             # This document (project structure + technical details)
│  ├─ agent-examples/            # Example source agent definitions (*.agent.md)
│  ├─ generated/                 # Generated artifacts committed to the repo (JSON, manifests, reports)
│  │  ├─ agent-examples/         # Compiled *.agent.json plus manifest/report
│  │  └─ gh-pages/               # GitHub Pages assets/manifests (e.g. scenarios manifest)
│  └─ issue-3-plan.md            # Historical plan for implementing the agent parser
├─ scripts/                      # Node scripts used by scenario test runner
│  ├─ run-scenarios.mjs          # Discovers/runs scenario tests and manages artifacts
│  └─ cli-scenario.mjs           # Scenario CLI harness/helper
├─ src/                          # TypeScript source
│  ├─ cli.ts                     # `tempybot` CLI (agent parsing command)
│  ├─ server.ts                  # Minimal HTTP server used by e2e/scenario tests
│  ├─ hello.ts                   # Small demo module used by tests/examples
│  └─ agent/
│     ├─ parse-agent-md.ts       # Parser: *.agent.md -> AgentDefinition JSON
│     └─ types.ts                # AgentDefinition TypeScript types
├─ tests/                        # Test suites
│  ├─ unit/                      # Fast unit tests (Vitest)
│  │  └─ integration/            # Opt-in unit integration tests (expected to need secrets in real projects)
│  ├─ e2e/                       # End-to-end tests (Playwright)
│  ├─ scenario/                  # “user flow” tests (cli/web) and integration variants
│  └─ test-utils.ts              # Shared helpers for tests
├─ package.json                  # Scripts, dependencies, Node engine constraints
├─ package-lock.json             # Locked dependency tree
├─ tsconfig.json                 # TypeScript config (dev/typecheck)
├─ tsconfig.build.json           # TypeScript config for producing `dist/`
├─ vitest.config.ts              # Unit test config
├─ vitest.scenario.config.ts     # Scenario test config
└─ README.md                     # High-level links + usage examples
```

## What this repo contains

- **Agent definition parser**: reads `*.agent.md` files and produces a typed JSON `AgentDefinition`.
- **CLI**: provides `tempybot parse <file.agent.md> [--out <file.json>]` to compile definitions.
- **Testing scaffold**: unit (Vitest), e2e (Playwright), and scenario (custom runner) tests.
- **GitHub Pages publishing**: pages include a project landing page and scenario video pages.

## Commands

All scripts are defined in `package.json`.

- **Build**
  - `npm run build`: compile TypeScript to `dist/` (CLI output lives at `dist/cli.js`)
  - `npm run typecheck`: typecheck without emitting
- **Tests (default)**
  - `npm test`: unit + e2e (non-integration)
- **Unit tests**
  - `npm run test:unit`: fast unit tests (excludes `tests/unit/integration`)
  - `npm run test:unit:integration`: opt-in unit integration suite
- **E2E tests (Playwright)**
  - `npm run test:e2e`: e2e tests excluding `@integration`
  - `npm run test:e2e:integration`: only tests tagged `@integration`
- **Scenario tests**
  - `npm run test:scenario:smoke`: fast scenario run, excludes integration scenarios
  - `npm run test:scenario:userlike`: userlike mode (records richer artifacts), excludes integration scenarios
  - `npm run test:scenario:userlike:web`: userlike mode for web scenarios, excludes integration scenarios
  - `npm run test:scenario:userlike:web:mobile`: userlike web scenarios emulating mobile, excludes integration scenarios
  - `npm run test:scenario:list`: list scenario tests without running them
  - `npm run test:scenario:integration`: run integration scenarios
  - `npm run test:scenario:integration:list`: list integration scenarios
- **Run all integration suites (gated/opt-in)**
  - `npm run test:integration`: runs unit integration + e2e integration + scenario integration

## Testing strategy

- **Unit tests**: `tests/unit/**/*.test.ts`
  - Fast, deterministic checks of core logic (including the `*.agent.md` parser).
- **E2E tests**: `tests/e2e/**/*.e2e.test.ts`
  - End-to-end flows across internal components (Playwright).
- **Scenario tests**: `tests/scenario/**/**/*.scenario.test.ts`
  - “One test = one user flow” runs via `scripts/run-scenarios.mjs`.
- **Integration tests** (opt-in)
  - Unit-style integration: `tests/unit/integration/**/*.test.ts`
  - E2E integration: Playwright tests tagged with `@integration`
  - Scenario integration: `tests/scenario/**/integration/**/*.scenario.test.ts`

## Scenario artifacts

Where artifacts land depends on the scenario mode:

- **Smoke mode**: per-scenario logs in `.cache/smokecheck/*.log`
- **Userlike mode**: richer artifacts under `artifacts/user-style-e2e/`

## GitHub Pages

- **Project Pages**: published under the repository GitHub Pages site.
- **Scenario pages**: published under `/scenarios` on the same Pages site.
- **Publishing**: workflows publish to Pages on pushes to `main`. Repository settings must have Pages enabled via
  **Settings → Pages → Source: GitHub Actions**.

