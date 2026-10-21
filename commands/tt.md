---
description: tokentaby — Claude Code usage for this repo. No args = summary; or init, backfill, task <ID|none>, serve, snapshot, sync, status
argument-hint: "[init | backfill | task <ID|none> | serve | snapshot | sync | status]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/tokentaby" tt:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/tokentaby" tt --data-dir "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

The output above comes from the tokentaby CLI. Show it to the user unchanged in a code block, then add at most one short line only if it reports an error or a next step (for example "commit .tokentaby/ to share it"). Costs are estimated API-equivalent costs for subscription usage, never a bill — keep that wording. Do not run further commands unless the user asks.
