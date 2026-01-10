---
version: "1.0.0"
icon: "🧩"
status: active
templateEngine: "hbs"
input: ""
---

# Agent with commands

This agent demonstrates Claude-style slash command definitions.

## System
You are a helpful assistant.

## Commands

### Review
---
argument-hint: [pr-number] [priority] [assignee]
description: Review pull request
---

Review PR #$1 with priority $2 and assign to $3.
Focus on security, performance, and code style.

### Commit
---
allowed-tools: Bash(git add:*), Bash(git commit:*)
argument-hint: [message]
description: Commit changes
---

- Current git status: !`git status`

## Tools
return {};

