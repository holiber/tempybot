## Issue #3 — Create a parser for `.agent.md` files

This repository currently contains a minimal TypeScript scaffold (unit/e2e/scenario tests), but no agent loader/parser yet.

The goal of issue #3 (step 1) is to **analyze the work** and produce a **4-PR plan** plus **npm package recommendations** for implementing a Markdown (`*.agent.md`) → JSON parser.

Reference format policy example:
- `https://github.com/holiber/Agnet/blob/c580ff70e0f2eaf0ba4f4ac36c079a452a904b01/docs/policy/stc/agents_definition.md`

### Scope (what the parser must do)

Based on the policy example, the loader/parser should:
- Read a `.agent.md` file
- Parse an optional YAML frontmatter block (case-insensitive keys)
- Parse specific Markdown headings/sections:
  - `# <Title>` → fallback `title`
  - first paragraph after `# <Title>` → fallback `description`
  - `## System` → `system`
  - `## Rules` → `rules`
  - `## Tools` → tools definition (JavaScript source; execution is runtime responsibility)
- Apply defaults when metadata is missing (e.g., version/icon/status/templateEngine)
- Enforce conflict rules:
  - if a value exists in both YAML and heading-derived metadata and differs (case-insensitive, trimmed), throw
- Validate structures:
  - `status` enum
  - `commands` list (paths/URLs/inline objects)
  - `required.startup` must reference a tool name in `## Tools` (case-insensitive)
  - optional `abilities` validation rules (allow/deny overlap errors, scoped `sh:<command>` form)

### Plan: 4 PRs

#### PR 1 — Foundation: types + frontmatter + minimal extraction
- Add `src/agent/types.ts` defining the JSON output shape (`AgentDefinition`, etc.).
- Add `src/agent/parse-agent-md.ts` with:
  - file reading
  - YAML frontmatter parsing
  - Markdown AST parsing
  - extraction for: title/description/system/rules (tools as raw section text for now)
  - defaults application (version/icon/status/templateEngine/input/recommended/required/commands)
- Add unit tests and fixtures under `tests/unit/agent/`.

Deliverable: deterministic parsing for the “core” metadata and sections.

#### PR 2 — Validation + conflict resolution
- Implement:
  - conflict detection between YAML vs heading-derived fields
  - validation of known enums/fields with clear, actionable errors
- Add tests for:
  - conflicting title/description/system/rules values
  - invalid `status`
  - empty/malformed fields

Deliverable: strict, safe loader behavior (stop on ambiguity).

#### PR 3 — Tools + commands resolution
- Parse `## Tools` section and expose:
  - `toolsSource` (string) and optional structured metadata if feasible (later)
- Implement `commands` normalization:
  - accept local paths / URLs / inline command objects
  - validate required fields for inline commands (`name`, `description`, `body`)
- Validate `required.startup` references a tool declared in `## Tools` (case-insensitive).

Deliverable: full coverage of “Tools/Commands/Startup requirements”.

#### PR 4 — Integration: file discovery + CLI + scenario coverage
- Add a small CLI command (example: `tempybot agent parse <glob...>`) that:
  - finds `.agent.md` files
  - parses each file
  - prints JSON or writes `*.json` next to inputs (decide in PR)
  - returns non-zero exit code on any validation error
- Add scenario tests for CLI behavior (success and failure cases).
- Add README documentation + a couple of example `.agent.md` fixtures.

Deliverable: developer-facing workflow for validating/inspecting `.agent.md` files.

### Recommended npm packages

#### Strongly recommended (robust parsing, minimal brittleness)
- **Markdown AST parsing**:
  - `unified`
  - `remark-parse`
  - `remark-frontmatter`
  - `mdast-util-to-string`
- **YAML/frontmatter**:
  - `gray-matter` (simple, common frontmatter extraction)
  - (alternative) `yaml` for more direct control
- **Validation**:
  - `zod` (TypeScript-first, readable errors)
  - (alternative) `ajv` (JSON Schema-first)

#### Nice-to-have
- **File discovery**:
  - `fast-glob` (for CLI multi-file support)

### Notes / constraints
- This repo already requires Node `>=20` and uses TypeScript + Vitest + Playwright.
- Regex-based Markdown parsing is likely to become fragile; prefer an AST-based approach.

