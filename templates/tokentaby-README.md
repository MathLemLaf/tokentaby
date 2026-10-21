# .tokentaby — Claude Code usage for this repo

This folder is written by the [tokentaby](https://github.com/mdsami/tokentaby) Claude Code plugin. Each developer's Claude Code usage in this repo is logged here and shared through git, so every clone can show the whole team's numbers.

## What is logged

| Event | Fields |
|---|---|
| `turn` (each Claude reply, per model) | time, dev id, session id, agent (`main` or a subagent id and type), model, input / output / cache-write / cache-read tokens, request count, estimated cost, task, branch, duration, effort |
| `prompt` | time, dev id, session id, task, a hash and the length of the prompt, and — depending on the prompt mode — its text |
| `task` | task set with `/tt task`, or created/completed by Claude Code's task list |
| `session` | start / end, model switches |

**Never logged:** file contents, tool output, code diffs, command output.

**Prompt text** follows `prompt_mode` in `config.json`:

- `truncated` (default): the first 200 characters, with obvious secrets (API keys, tokens, passwords) replaced by `[REDACTED]`
- `hash_only`: no text at all, only a hash and the length
- `full`: the whole prompt, secrets redacted

The team setting is a floor: each developer's plugin setting can make their own logging more private, never less. Commits are refused when a logged line still looks like a credential.

**Costs are estimated, API-equivalent** prices from `pricing.json`. The team pays a subscription, so the figures are for comparison and budgeting, not a bill.

## Layout

| Path | What |
|---|---|
| `devs/<dev>/<YYYY-MM>.ndjson` | one developer's events for a month: append-only, one JSON object per line |
| `rollups/<YYYY-MM>.ndjson` | older months squashed into daily totals by `tokentaby rollup` |
| `pricing.json` | price table, USD per million tokens; edit it in the dashboard's Settings |
| `config.json` | team policy: `prompt_mode`, `sync` (`ride-along` / `auto-commit` / `manual`), `truncate_chars` |
| `devs.json` | optional display names and commit emails per dev id |
| `.gitattributes` | `merge=union`, so concurrent appends never conflict |

Each developer only ever writes `devs/<their id>/`. Until usage is committed, new events wait in `.git/tokentaby/`, so `git status` stays clean.

## Viewing

- `/tt` in Claude Code: today, this week and this month, you vs the team
- `/tt serve` or `tokentaby serve`: the dashboard at http://localhost:7331
- Ask Claude, for example "what did TKT-142 cost?"

Run `git pull` to get teammates' latest usage.
