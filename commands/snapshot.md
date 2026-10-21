---
description: Save the dashboard as one offline HTML file
argument-hint: "[--no-prompts] [--out FILE]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tokentaby.js" snapshot:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokentaby.js" snapshot --data-dir "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

The output above comes from the tokentaby CLI. Show it to the user unchanged in a code block, then add at most one short line only if it reports an error or a next step. Costs are estimated API-equivalent costs for subscription usage, never a bill — keep that wording. Do not run further commands unless the user asks.
