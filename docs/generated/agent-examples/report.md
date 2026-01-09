# Agent examples compilation report

This folder is generated from `docs/agent-examples/*.agent.md` using the repository parser `parseAgentMd`.

## Summary

- Source files: 10
- Output files: 10 JSON + manifest + report

## Data preservation notes

- Each compiled JSON file contains the full `AgentDefinition` shape (all expected keys are asserted in tests).
- The parser preserves `recommended` and `required` objects (including extra keys inside those objects).
- Content outside the supported surface (e.g. additional headings/sections, unknown top-level frontmatter keys) is not represented in `AgentDefinition` and will not appear in the compiled JSON.

## Per-file overview

| Source | Title | Status | Commands | System chars | Rules chars | Tools chars |
|--------|-------|--------|----------|--------------|------------|------------|
| codebase-migration-planner.agent.md | Codebase Migration Planner | active | 2 | 260 | 365 | 520 |
| customer-support-triage.agent.md | Customer Support Triage Agent | active | 2 | 236 | 389 | 417 |
| etl-pipeline-debugger.agent.md | ETL Pipeline Debugger | active | 1 | 205 | 350 | 328 |
| kubernetes-incident-responder.agent.md | Kubernetes Incident Responder | active | 0 | 289 | 426 | 606 |
| product-requirements-writer.agent.md | Product Requirements Writer | active | 1 | 210 | 266 | 333 |
| python-data-cleaner.agent.md | Python Data Cleaner | active | 1 | 248 | 343 | 374 |
| release-manager.agent.md | Release Manager Agent | active | 1 | 192 | 312 | 443 |
| security-dependency-auditor.agent.md | Security Dependency Auditor | active | 2 | 211 | 335 | 294 |
| sql-performance-tuner.agent.md | SQL Performance Tuner | active | 2 | 224 | 476 | 375 |
| terraform-pr-reviewer.agent.md | Terraform PR Reviewer | active | 1 | 228 | 411 | 523 |
