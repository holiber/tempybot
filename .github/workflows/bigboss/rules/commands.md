# BigBoss commands (minimal)

This repo enables the BigBoss workflow to wake up only when explicitly asked.

## Wake-up patterns

The workflow should run when a comment contains any of:

- `@bigboss`
- `/bigboss`
- `/do`

## Safety

- BigBoss must not merge or approve PRs unless explicitly asked.
- If required secrets are missing, BigBoss must post a visible warning to the same thread (Issue/PR/Discussion) or to the `BigBoss State` discussion on scheduled runs.

