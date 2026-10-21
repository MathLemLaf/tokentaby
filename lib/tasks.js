'use strict';
// Task attribution. Resolution order (first hit wins):
//   1. explicit `/tokentaby:task TKT-142` typed in this session
//   2. explicit `tokentaby task TKT-142` for this clone, while on the same branch
//   3. a ticket id in the branch name (feat/TKT-142-retry -> TKT-142)
//   4. the subject of the latest Claude Code task created in this session
//   5. null

const TICKET_RE = /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]+-\d+)(?![A-Za-z0-9])/;

function ticketFromBranch(branch) {
  const m = TICKET_RE.exec(branch || '');
  return m ? m[1] : null;
}

/**
 * Task set by a `/tokentaby:task ...` prompt: the id, null for "none"/"clear",
 * or undefined when the prompt is not that command.
 */
function parseTaskCommand(prompt) {
  const m = /^\s*\/tokentaby:task(?:\s+([\s\S]+?))?\s*$/i.exec(prompt || '');
  if (!m) return undefined;
  const v = (m[1] || '').trim().slice(0, 120);
  return v && !/^(none|clear|off|-)$/i.test(v) ? v : null;
}

function resolveTask({ session = {}, clone = null, branch = null }) {
  if (session.task) return session.task;
  if (clone && clone.id && (!clone.branch || clone.branch === branch)) return clone.id;
  return ticketFromBranch(branch) || session.claudeTask || null;
}

module.exports = { ticketFromBranch, parseTaskCommand, resolveTask };
