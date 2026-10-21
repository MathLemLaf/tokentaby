---
description: Usage and estimated cost: today, this week, this month, you vs the team
argument-hint: "[--from YYYY-MM-DD] [--to YYYY-MM-DD]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tokentaby.js" summary:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokentaby.js" summary --data-dir "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

The output above comes from the tokentaby CLI. Show it to the user unchanged in a code block, then add at most one short line only if it reports an error or a next step. Costs are estimated API-equivalent costs for subscription usage, never a bill — keep that wording. Do not run further commands unless the user asks.
