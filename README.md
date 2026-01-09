# tempybot

Minimal repo scaffold with unit, e2e, and scenario tests.

## GitHub Pages

- **Project Pages**: [holiber.github.io/tempybot](https://holiber.github.io/tempybot/)
- **Scenario videos**: [holiber.github.io/tempybot/scenarios](https://holiber.github.io/tempybot/scenarios/)

## Commands

- `npm test`: unit + e2e
- `npm run test:scenario:smoke`: scenario tests (fast)
- `npm run test:scenario:list`: list scenario tests
- `npm run test:integration`: integration tests (gated / opt-in)

## CI / Testing strategy

- **Unit tests**: `tests/unit/**/*.test.ts` (fast, no external dependencies)
- **E2E tests**: `tests/e2e/**/*.e2e.test.ts` (end-to-end across internal components)
- **Scenario tests**: `tests/scenario/**/**/*.scenario.test.ts` (one test = one user flow)
- **Integration tests**: opt-in suites that are expected to require secrets in real projects:
  - unit-style integration: `tests/unit/integration/**/*.test.ts`
  - e2e integration: tests tagged with `@integration`
  - scenario integration: `tests/scenario/**/integration/**/*.scenario.test.ts`

## Scenario artifacts

- **Smoke mode**: creates per-scenario logs in `.cache/smokecheck/*.log`
- **Userlike mode**: records artifacts under `artifacts/user-style-e2e/`

## GitHub Pages (scenario videos)

This repo includes a workflow that publishes scenario videos to GitHub Pages under `/scenarios`
on pushes to `main`. You must enable Pages in repository settings: **Settings → Pages → Source: GitHub Actions**.

