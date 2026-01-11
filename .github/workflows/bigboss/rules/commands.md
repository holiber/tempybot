# BigBoss commands (minimal)

This repo enables the BigBoss workflow to wake up only when explicitly asked.

## Wake-up patterns

The workflow should run when a comment contains any of:

- `@bigboss`
- `@bigbos` (common typo)
- `/bigboss`
- `/do`

## Arbitrary messages

Anything after the mention is treated as the prompt.

Examples:

- `@bigboss hello!`
- `@bigboss please summarize the last 3 comments in this PR`

## Safety

- BigBoss must not merge or approve PRs unless explicitly asked.
- If required secrets are missing, BigBoss must post a visible warning to the same thread (Issue/PR/Discussion) or to the `BigBoss State` discussion on scheduled runs.

