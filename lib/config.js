'use strict';
// Effective settings = plugin userConfig (per dev) layered over the repo's
// committed team policy (.tokentaby/config.json) and built-in defaults.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  dev_id: '',
  prompt_mode: 'truncated',
  sync: 'ride-along',
  port: 7331,
  currency: 'USD',
  truncate_chars: 200,
};

// Least to most private. The team setting is a floor: a dev may choose a more
// private mode than the team's, never a less private one.
const PROMPT_MODES = ['full', 'truncated', 'hash_only'];
const SYNC_MODES = ['ride-along', 'auto-commit', 'manual'];
// the currencies Claude bills subscriptions in; costs are computed in USD and converted for display
const CURRENCIES = ['USD', 'CAD', 'INR', 'EUR'];
const OPTION_KEYS = ['dev_id', 'prompt_mode', 'sync', 'port', 'currency'];

/**
 * Raw per-dev options. Inside Claude Code they arrive as
 * CLAUDE_PLUGIN_OPTION_<KEY>; outside (git hooks, CLI) TOKENTABY_<KEY> or the
 * snapshot SessionStart saved in the clone's local state.
 */
function userOptions(saved) {
  const out = {};
  for (const k of OPTION_KEYS) {
    const v = firstSet(process.env['CLAUDE_PLUGIN_OPTION_' + k.toUpperCase()], process.env['TOKENTABY_' + k.toUpperCase()], saved && saved[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// "team" (the plugin option's default) and "" mean "use the repo's .tokentaby/config.json"
function firstSet(...vals) {
  for (const v of vals) {
    const s = v === undefined || v === null ? '' : String(v).trim();
    if (s !== '' && s.toLowerCase() !== 'team') return s;
  }
  return undefined;
}

function teamConfig(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, '.tokentaby', 'config.json'), 'utf8')) || {};
  } catch {
    return {};
  }
}

function oneOf(v, allowed) {
  return allowed.includes(v) ? v : undefined;
}

function resolveConfig(repoRoot, savedOptions) {
  const team = teamConfig(repoRoot);
  const user = userOptions(savedOptions);

  const userMode = oneOf(user.prompt_mode, PROMPT_MODES);
  const teamMode = oneOf(team.prompt_mode, PROMPT_MODES);
  let promptMode = DEFAULTS.prompt_mode;
  if (userMode && teamMode) promptMode = PROMPT_MODES[Math.max(PROMPT_MODES.indexOf(userMode), PROMPT_MODES.indexOf(teamMode))];
  else promptMode = userMode || teamMode || DEFAULTS.prompt_mode;

  const port = parseInt(user.port || team.port, 10);
  const chars = parseInt(team.truncate_chars, 10);
  return {
    dev_id: user.dev_id || '',
    prompt_mode: promptMode,
    sync: oneOf(user.sync, SYNC_MODES) || oneOf(team.sync, SYNC_MODES) || DEFAULTS.sync,
    port: port > 0 && port < 65536 ? port : DEFAULTS.port,
    currency: oneOf(String(user.currency || '').toUpperCase(), CURRENCIES) || oneOf(String(team.currency || '').toUpperCase(), CURRENCIES) || DEFAULTS.currency,
    truncate_chars: chars > 0 ? chars : DEFAULTS.truncate_chars,
    team,
  };
}

module.exports = { resolveConfig, userOptions, teamConfig, DEFAULTS, PROMPT_MODES, SYNC_MODES, CURRENCIES, OPTION_KEYS };
