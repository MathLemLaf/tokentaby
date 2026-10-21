# TokenTaby

**Claude Code usage tracking for teams: per repo, per developer, committed to git.**

tokentaby is a Claude Code plugin that records every turn in a repository: tokens, model, main agent or subagent, task, branch, prompt and estimated cost. The data is stored as plain NDJSON inside the repo, so `git pull` gives every clone the whole team's numbers. It needs no server and no setup beyond installing the plugin. A local dashboard and a `/tt` command show the totals.

> **Costs are estimates.** Teams on Claude Pro / Max / Team subscriptions don't pay per token. tokentaby prices tokens at Anthropic's API list prices ("API-equivalent") for comparison and budgeting, never as a bill.

---

## What you get

- **What the repo costs:** input, output, cache-write and cache-read tokens plus estimated cost, by day, week and month.
- **Who uses what:** per-developer totals, model mix and a team leaderboard.
- **Which model did which work:** cost by model, by agent (main, Explore, Plan, your custom agents) and by task.
- **What people ask for:** a prompt log with configurable redaction, plus prompts per task and per model.
- **Agent overhead:** main agent vs subagent spend, per agent type and per session.
- **Task economics:** cost per task, branch or PR, cheapest vs priciest.
- **Ask Claude:** "what did TKT-142 cost?" works in any session.

## Requirements

- Claude Code **2.1.271 or newer** (tested on 2.1.307)
- **Node.js 18+** on your `PATH` (the hooks are dependency-free Node scripts that run on macOS, Linux and Windows)
- **git** — the repo you track must be a git repository

---

## Install from the marketplace

This repository is also a plugin marketplace, so installing takes two commands.

**From your terminal:**

```bash
claude plugin marketplace add mdsami/tokentaby
claude plugin install tokentaby@tokentaby
```

**Or inside Claude Code:**

```
/plugin marketplace add mdsami/tokentaby
/plugin install tokentaby@tokentaby
```

Restart Claude Code, or run `/reload-plugins`. That's all the per-developer setup. Each repo opts in once with `/tt init` (next section).

### Roll it out to a team, pinned to one version

Pin the plugin in the repo so all developers run the same version and schema. Commit this as `.claude/settings.json` (or merge it into the existing file):

```json
{
  "extraKnownMarketplaces": {
    "tokentaby": {
      "source": { "source": "github", "repo": "mdsami/tokentaby", "ref": "tokentaby--v0.1.0" }
    }
  },
  "enabledPlugins": {
    "tokentaby@tokentaby": true
  }
}
```

Each developer then runs this once:

```bash
claude plugin install tokentaby@tokentaby --scope project
```

To upgrade the team, change `ref` to the new release tag and commit.

### Update or remove

```bash
claude plugin marketplace update tokentaby   # fetch the latest catalog
claude plugin update tokentaby               # then restart Claude Code
claude plugin uninstall tokentaby
```

### Try it from a clone (no install)

```bash
git clone https://github.com/mdsami/tokentaby.git
claude --plugin-dir ./tokentaby
```

---

## Set up a repository (once per repo)

In Claude Code, inside the repo you want to track:

```
/tt init
```

This creates `.tokentaby/` (price table, team policy, README, `merge=union` attributes) and installs a git `pre-commit` hook. Commit the folder so the whole team starts tracking:

```bash
git add .tokentaby && git commit -m "chore: add tokentaby usage tracking"
```

Repos without `.tokentaby/` are never touched, because collection is opt-in per repo. Teammates need nothing beyond the plugin: their first session in the repo installs their own git hook.

**Import your history:** `/tt backfill` reads this repo's past sessions from `~/.claude/projects/` and splits them into per-turn rows, so the dashboard has data from day one. It shares the live hooks' watermarks, so a session is never counted twice, and running it again imports nothing new. Each developer runs it once for their own history.

Options (terminal form: `node <plugin>/bin/tokentaby init …`, or `/tt init …`):

| Option | Effect |
|---|---|
| `--sync ride-along \| auto-commit \| manual` | how usage reaches git (see [Git sync modes](#git-sync-modes)); default `ride-along` |
| `--prompt-mode truncated \| hash_only \| full` | team privacy policy for prompt text; default `truncated` |
| `--ci` | also write `.github/workflows/tokentaby.yml` (the CI guard) |
| `--hook-in-tracked-dir` | install the hook even when `core.hooksPath` points at a tracked folder (husky & co.) |

---

## Daily use

| In Claude Code | What it does |
|---|---|
| `/tt` | today / this week / this month, **you vs the team** |
| `/tt serve` | start the dashboard in the background → http://localhost:7331 |
| `/tt task TKT-142` | attribute this branch's usage to a task (`/tt task none` clears it) |
| `/tt status` | what's tracked, queued and configured in this clone |
| `/tt backfill` | import your past sessions in this repo (once) |
| `/tt snapshot` | write the dashboard as one offline HTML file (`--no-prompts` to share safely) |
| `/tt sync` | commit your queued usage now (manual / auto-commit modes) |
| `/tt push` | `git push` the current branch |
| *"what did TKT-142 cost?"* | Claude answers from the logs using the bundled `tokentaby` skill |

Commands from plugins are namespaced, so `/tt` is also available as `/tokentaby:tt`, and the skill as `/tokentaby:tokentaby`.

Example `/tt` output:

```
tokentaby · web-app · estimated API-equivalent cost (subscription usage, not a bill)

             you (sami)   est. cost   prompts   team tokens   est. cost   prompts   sessions   devs
today              2.1M       $4.12        18         19.4M      $38.90       143         41      9
this week         11.8M      $23.70        96         98.2M     $201.44       771        203     14
this month        40.3M      $81.02       331        402.7M     $812.15     3,104        790     15

Top model this month: claude-opus-5-5   Top task: TKT-142 ($64.20)
Queued, not yet committed: 12 events · sync: ride-along · prompts: truncated
```

**Task attribution** is resolved in this order:

1. explicit `/tt task TKT-142`
2. a ticket id in the branch name (`feat/TKT-142-retry` → `TKT-142`)
3. the Claude Code task-list subject
4. none

---

## The dashboard

```bash
/tt serve                       # inside Claude Code (runs in the background)
node <plugin>/bin/tokentaby serve [--port 7331] [--no-open]
node <plugin>/bin/tokentaby serve --stop
```

A single-file local web app with no build step and no CDN, so it works offline. It binds to `127.0.0.1` only.

> **Claude Code sandbox on?** A sandboxed Bash can't open local ports, so `/tt serve` reports `not allowed to open port`. Start the dashboard from the prompt with `!`, which runs the command in your own shell:
> `! node <plugin>/bin/tokentaby serve --detach && open http://localhost:7331`
> Alternatively, allow it with `"sandbox": { "network": { "allowLocalBinding": true } }` in your settings.

**Offline snapshot:** `tokentaby snapshot [--out FILE] [--no-prompts]` writes the whole dashboard, data included, as one HTML file that opens from disk with no server. It stays interactive: filters, tables and CSV export all work. Use `--no-prompts` before sharing it outside the team.

| Page | Shows |
|---|---|
| **Overview** | team total and estimated cost for the range (vs the previous period), 30-day trend, daily cost by model, model share, agent share, top 5 developers and tasks |
| **Developers** | sessions, prompts, tokens by type, cost, favourite model, subagent share. Click a developer for their timeline, model mix, tasks and prompt log |
| **Models** | cost by model over time; which developers, tasks and agents used each model; prompts answered |
| **Agents** | spend by agent type, subagent overhead per session |
| **Tasks** | cost per task and branch, prompts, models, active time, cheapest vs priciest |
| **Prompts** | searchable log grouped by session (respects the prompt mode) |
| **Settings** | pricing-table editor, developer names, CSV/JSON export |

Filters (date range, developer, model, logged vs current prices, currency) apply to every chart and table. Each chart has a table view. Light and dark themes are included.

**Currencies:** estimates are computed in USD and can be shown in **USD (default), INR or EUR**, the currencies Claude bills subscriptions in. Rates live in the `fx` table of `.tokentaby/pricing.json`, and the team can update them.

**JSON API** (for Sheets, Grafana or scripts): `GET /api/summary?from=&to=`, `/api/devs`, `/api/devs/<id>`, `/api/models`, `/api/agents`, `/api/tasks`, `/api/prompts?q=`, `/api/events`, `/api/export.csv?kind=turns|prompts|devs|tasks|models`. All accept `from`, `to`, `dev`, `model` and `prices=current`.

---

## Configuration

### Your plugin options (per developer)

Set these in `/plugin` → tokentaby, or from the terminal with `claude plugin configure tokentaby`:

| Option | Default | Meaning |
|---|---|---|
| `dev_id` | *(git email local part)* | your id in `.tokentaby/devs/<id>/` |
| `prompt_mode` | `team` | `team` (use the repo policy), `truncated`, `hash_only` or `full`. You can be **more** private than the team, never less |
| `sync` | `team` | `team`, `ride-along`, `auto-commit` or `manual` |
| `port` | `7331` | dashboard port |
| `currency` | `USD` | `USD`, `INR` or `EUR` |

### Team policy (committed): `.tokentaby/config.json`

```json
{ "prompt_mode": "truncated", "sync": "ride-along", "truncate_chars": 200 }
```

### Prices: `.tokentaby/pricing.json`

USD per million tokens, editable in the dashboard's Settings. Cache writes cost 1.25× input (5-minute TTL) or 2× (1-hour TTL). Cache reads default to 0.1× input unless a model overrides it (Opus 5.5, Sonnet 5.5 and Fable 5.1 do). Long-context tiers (e.g. Haiku 5.5 above 100K prompt tokens), fast mode (2×) and web search ($10 per 1,000 searches) are priced per request.

Cost is stored with each event when it is written, so history stays stable when prices change. Pick **Prices: current table** in the dashboard to re-cost history.

---

## Git sync modes

Hooks never write into your working tree. New events wait in a spool inside `.git/tokentaby/`, so a Claude session never leaves `git status` dirty or blocks `checkout`, `pull --rebase` or `stash`. The spool moves into `.tokentaby/devs/<you>/<YYYY-MM>.ndjson` when usage ships:

| Mode | When usage ships |
|---|---|
| **ride-along** (default) | the `pre-commit` hook adds your usage to the commit you're making anyway. No extra commits |
| **auto-commit** | at session end, a separate `chore(usage): <dev> <date>` commit containing only your usage. Never pushed. Skipped during a rebase or merge, or on a detached HEAD |
| **manual** | only when you run `/tt sync` (then `/tt push`) |

In every mode the hook **refuses a commit** if a staged usage line looks like a credential.

Each developer writes only their own `devs/<id>/` files, and `merge=union` resolves concurrent appends, so usage data never causes merge conflicts.

---

## Privacy

| Logged | Never logged |
|---|---|
| timestamps, dev id, session id, model, agent, token counts, estimated cost, task, branch, duration, effort | file contents, tool output, code diffs, command output |
| prompts: hash + length, plus text per `prompt_mode` | |

- `truncated` (default): the first 200 characters, with obvious secrets (API keys, GitHub/Slack/AWS tokens, JWTs, private keys, `password=…`) replaced by `[REDACTED]` **before** anything is written.
- `hash_only`: no text at all.
- `full`: the whole prompt, redacted the same way.

The first session in a tracked repo shows a one-time notice of what is logged. The repo's `.tokentaby/README.md` documents it for everyone.

---

## CI guard

`/tt init --ci` adds a GitHub Action that runs on pull requests touching `.tokentaby/`. It fails the PR when:

- a log line is invalid JSON or doesn't match the schema;
- a commit adds lines to **another developer's** log (author email → dev id, with aliases from `.tokentaby/devs.json`);
- a logged line looks like a secret.

Run the same checks locally:

```bash
node <plugin>/bin/tokentaby validate --base origin/main
```

---

## Maintenance

```bash
tokentaby rollup [--before YYYY-MM] [--drop-prompts] [--dry-run]
```

Squashes monthly logs older than last month into `.tokentaby/rollups/<YYYY-MM>.ndjson` daily totals, which keeps the repo small and the dashboard fast. Prompts are kept verbatim unless you pass `--drop-prompts`.

```bash
tokentaby ingest-otel <otlp-export.json> [--dev ID] [--all-sessions] [--dry-run]
```

Optional, for teams that already export Claude Code OpenTelemetry. It imports `claude_code.api_request` events for what transcripts can't show (compaction and other background calls, or sessions where hooks didn't run) and never double-counts what hooks recorded.

---

## CLI reference

The CLI ships inside the plugin. Run it as `node <plugin-dir>/bin/tokentaby <command>`, or link it once with `npm link` from a clone.

```
summary                     today / week / month, you vs team (default)
serve [--port N] [--detach] [--stop] [--no-open]
init [--sync MODE] [--prompt-mode MODE] [--ci] [--hook-in-tracked-dir]
task <ID> | task none
sync | push | status
query <view> [filters]      JSON: summary periods devs dev <id> models agents tasks prompts events
export [--kind turns|prompts|devs|tasks|models] [--format csv|json] [--out FILE]
rollup [--before YYYY-MM] [--drop-prompts] [--dry-run]
validate [--base REF] [--head REF]
ingest-otel <file> [--dev ID] [--all-sessions] [--dry-run]
backfill [--source PATH] [--project-dir DIR] [--since YYYY-MM-DD] [--dry-run]
snapshot [--out FILE] [--no-prompts]

Filters: --from YYYY-MM-DD --to YYYY-MM-DD --dev ID --model ID --task ID
         --agent TYPE --branch NAME --q TEXT --prices current
Global:  --repo PATH --json
```

---

## How it works

```
Claude Code session
  │ hooks: SessionStart, UserPromptSubmit, Stop, SubagentStart/Stop,
  │        TaskCreated/Completed, PostModelSwitch, PreCompact, SessionEnd
  ▼
hooks/collect.js  (Node, no dependencies, always exits 0, async where possible)
  │ reads the session transcript since its watermark, dedupes on message.id,
  │ sums usage per model, prices each request
  ▼
.git/tokentaby/spool.ndjson   (clone-local queue)
  │ pre-commit (ride-along) │ session end (auto-commit) │ /tt sync (manual)
  ▼
.tokentaby/devs/<dev>/<YYYY-MM>.ndjson   (committed, append-only, merge=union)
  │ git push / pull → every clone has the whole team
  ▼
tokentaby serve → http://localhost:7331   ·   /tt   ·   the tokentaby skill
```

Each event is one JSON line:

```jsonc
{"v":1,"t":"turn","ts":"2026-10-21T14:03:11Z","dev":"sami","session":"a1b2…","agent":"main","agent_type":null,
 "model":"claude-opus-5-5","in":1820,"out":412,"cw":0,"cr":31200,"usd":0.0213,"task":"TKT-142",
 "branch":"feat/TKT-142-retry","dur_ms":8400,"req":3,"effort":"high"}
{"v":1,"t":"prompt","ts":"…","dev":"sami","session":"a1b2…","task":"TKT-142","hash":"3f2a…","chars":214,"text":"add retry to the webhook handler"}
{"v":1,"t":"task","ts":"…","dev":"sami","session":"a1b2…","task":"TKT-142","status":"set","title":null}
{"v":1,"t":"session","ts":"…","dev":"sami","session":"a1b2…","event":"start","source":"startup","cwd_rel":".","branch":"main","model":"claude-opus-5-5"}
```

Details that keep the numbers right:

- Claude Code writes one transcript entry per content block, each repeating the message's final usage. tokentaby counts each `message.id` once.
- Subagent transcripts (`<session>/subagents/agent-<id>.jsonl`) are processed separately and tagged with their agent type.
- Watermarks (in the plugin's data dir) make every hook idempotent. A per-transcript lock stops concurrent hooks from double counting.
- History that a resumed or forked session was seeded with is skipped.
- `<synthetic>` placeholder messages (no API call) are ignored.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing is logged | Is `.tokentaby/` committed in this repo? Is `node` on your `PATH`? Run `/tt status`. |
| Usage never reaches git | `/tt status` shows `pre_commit_hook`. With husky or another `core.hooksPath`, re-run `/tt init --hook-in-tracked-dir` or add the block yourself. Or switch to `auto-commit`. |
| A teammate is missing | `git pull`. Their usage arrives with their commits. |
| Commit refused for a secret | Edit the named line (replace the value with `[REDACTED]`), re-stage and commit. |
| Debugging hooks | Start Claude Code with `TOKENTABY_DEBUG=1`. Payloads and errors go to `debug.ndjson` in the plugin data dir (`/tt status` shows it). |

---

## Development

```bash
npm test                        # node --test, no dependencies
claude plugin validate .        # manifest + marketplace checks
claude --plugin-dir .           # run Claude Code with your working copy
```

To release: bump `version` in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `package.json`, then run `claude plugin tag`. It creates the `tokentaby--v<version>` tag that teams pin to. Push the tag.

```
.claude-plugin/        plugin.json (manifest + options), marketplace.json
hooks/                 hooks.json (exec-form, no shell), collect.js (single entry)
lib/                   transcript-adapter, pricing, store, git, sync, aggregate,
                       server, api, snapshot, backfill, validate, rollup, otel,
                       secrets, tasks, config
bin/tokentaby          CLI
dashboard/index.html   single-file UI
commands/tt.md         /tt
skills/tokentaby/      lets Claude answer usage questions
templates/             pricing table, repo README, CI workflow, team settings
test/                  unit + end-to-end tests with transcript fixtures
```
