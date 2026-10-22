---
name: tokentaby
description: Answer questions about Claude Code usage (this repo, or in hub mode ALL of the user's folders by sphere / application / type) — e.g. "combien m'a coûté la sphère Investissement ce mois-ci ?", "quelle application consomme le plus ?", and estimated cost from tokentaby's logs — e.g. "what did TKT-142 cost?", "who used the most Opus this week?", "how much do subagents add?", "which tasks were cheapest?", "what has the team been asking Claude?".
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tokentaby.js" query:*)
---

# Usage analysis with tokentaby

tokentaby logs every Claude Code turn in this repo (tokens, model, agent, task, branch, estimated cost) to `.tokentaby/devs/<dev>/<YYYY-MM>.ndjson`, committed to git, so a pulled clone holds the whole team's usage. Query it with the bundled CLI — it prints JSON:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/tokentaby.js" query <view> [filters]
```

| view | answers |
|---|---|
| `summary` | totals for a range, previous-period comparison, daily series, model / agent share, top devs and tasks |
| `periods` | today / this week / this month, the current dev vs the team |
| `devs` | per developer: sessions, prompts, tokens by type, cost, favourite model, subagent share |
| `dev <id>` | one developer: timeline, model mix, tasks, recent prompts |
| `models` | per model: cost, tokens, requests, prompts answered, which devs / tasks / agents used it |
| `agents` | spend by agent type (main vs Explore, Plan, custom…) and subagent overhead per session |
| `tasks` | per task and per branch: cost, tokens, prompts, models, devs, active time |
| `prompts` | the prompt log (respects the repo's prompt mode); `--q TEXT` searches text, task id or hash |
| `spheres` | mode hub : coût par sphère → applications, par type d'usage, par dossier, et série quotidienne par sphère |
| `events` | raw events, for anything the views do not cover |

Filters: `--from YYYY-MM-DD --to YYYY-MM-DD --dev ID --model ID --task ID --agent TYPE --branch NAME --q TEXT`, and in hub mode `--sphere NOM --app NOM --kind TYPE` (they work with every view). Add `--prices current` to re-cost history with today's pricing table instead of the price logged at the time. `summary` defaults to the current month; most other views default to all time — pass a range when the question names one.

Examples:

- "What did TKT-142 cost?" → `query tasks --task TKT-142`
- "Who used the most Opus this week?" → `query devs --model claude-opus-5-5 --from <monday> --to <today>`
- "How much do subagents add?" → `query agents`
- « Combien m'a coûté la généalogie ce mois-ci ? » → `query summary --sphere Généalogie`
- « Quelle application consomme le plus ? » → `query spheres --from <date> --to <today>`

## Mode hub (cette version)

When a hub is configured (`~/.tokentaby-hub`), every view reads ONE central repo holding all of the user's Claude Code usage, from every folder. Each event carries `proj` (the project folder, e.g. `~/dev/genealogie`), classified at read time by `.tokentaby/spheres.json` into a sphere, an application and a type. To change how a folder is classified, edit that file (first matching rule wins) and check with `tokentaby hub rules`. The user is French-speaking: answer in French.

## How to answer

- Always call costs **estimated (API-equivalent)**. The team is on Claude subscriptions; these are list-price estimates for comparison and budgeting, not a bill.
- Tokens come in four kinds: input, output, cache write and cache read. Cache reads dominate raw token counts, so lead with estimated cost, and mention the token mix only when it matters.
- Usage not yet committed sits in this clone's queue, so only this developer's newest turns are visible before they commit. Teammates' usage arrives with `git pull`.
- If the CLI says tokentaby is not set up, tell the user to run `/tokentaby:init` (then `/tokentaby:backfill` for their history) and commit `.tokentaby/`.
- Never print raw prompt text beyond what the user asked for. In `hash_only` mode no text exists; say so instead of guessing.
