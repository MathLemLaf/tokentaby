'use strict';
// Everything that knows Claude Code's transcript format lives here, so a
// format change is a one-file fix. The format is undocumented; these facts
// were verified against Claude Code 2.1.30x transcripts (see README "Phase 0"):
//
//  - ~/.claude/projects/<slug>/<session>.jsonl, one JSON object per line.
//  - An assistant message is written as one entry per content block
//    (thinking, text, tool_use...). Every entry repeats message.id and the
//    same final message.usage, so usage is deduped on message.id.
//  - message.usage: input_tokens, output_tokens, cache_creation_input_tokens,
//    cache_read_input_tokens, cache_creation.ephemeral_{5m,1h}_input_tokens,
//    server_tool_use.web_search_requests, speed ("standard" | "fast").
//  - entry.effort carries the reasoning effort; message.model the served model.
//  - message.model "<synthetic>" marks locally generated placeholders (no API call).
//  - Subagents write <slug>/<session>/subagents/agent-<agentId>.jsonl plus
//    agent-<agentId>.meta.json ({ agentType, description, ... }). Their entries
//    carry isSidechain:true, agentId, attributionAgent and the parent sessionId,
//    and are NOT duplicated in the main transcript.

const fs = require('fs');
const path = require('path');

const MAX_READ = 64 * 1024 * 1024;

/**
 * Complete lines appended to `file` since byte `offset` (and before byte
 * `limit`, when given). Returns { text, end } where end is the offset just
 * past the last newline, or null when nothing new is readable. A file
 * shorter than the offset was rewritten, so it is read again from the start
 * (reset: true).
 */
function readIncrement(file, offset, limit) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    let start = offset || 0;
    let reset = false;
    if (size < start) {
      start = 0;
      reset = true;
    }
    const stop = limit != null ? Math.min(size, limit) : size;
    if (stop <= start) return reset ? { text: '', end: 0, reset } : null;
    const len = Math.min(stop - start, MAX_READ);
    const buf = Buffer.allocUnsafe(len);
    let got = 0;
    while (got < len) {
      const n = fs.readSync(fd, buf, got, len - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    const lastNl = buf.lastIndexOf(0x0a, got - 1);
    if (lastNl < 0) return reset ? { text: '', end: 0, reset } : null;
    return { text: buf.toString('utf8', 0, lastNl + 1), end: start + lastNl + 1, reset };
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a corrupt line must not poison the rest of the batch
    }
  }
  return out;
}

function num(v) {
  return typeof v === 'number' && v > 0 ? Math.round(v) : 0;
}

/**
 * Billable API messages in a batch of entries, deduped on message.id
 * (the last entry wins, unless it reports less output than an earlier one).
 * History copied in by resume/fork is skipped two ways: entries stamped with
 * another sessionId, and (opts.minTs) messages older than the session start.
 * Also returns the batch's first/last timestamps and last git branch.
 */
function extractMessages(entries, opts = {}) {
  const byId = new Map();
  let first = null;
  let last = null;
  let branch = null;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const ts = typeof e.timestamp === 'string' ? e.timestamp : null;
    if (ts) {
      if (!first || ts < first) first = ts;
      if (!last || ts > last) last = ts;
    }
    if (typeof e.gitBranch === 'string' && e.gitBranch && e.gitBranch !== 'HEAD') branch = e.gitBranch;
    if (e.type !== 'assistant' || !e.message) continue;
    if (opts.sessionId && e.sessionId && e.sessionId !== opts.sessionId) continue;
    if (opts.minTs && ts && ts < opts.minTs) continue;
    const m = e.message;
    const u = m.usage;
    if (!u || !m.model || m.model === '<synthetic>') continue;
    const rec = {
      id: m.id || e.requestId || e.uuid,
      model: m.model,
      ts,
      effort: typeof e.effort === 'string' ? e.effort : null,
      speed: typeof u.speed === 'string' ? u.speed : null,
      agentType: typeof e.attributionAgent === 'string' ? e.attributionAgent : null,
      in: num(u.input_tokens),
      out: num(u.output_tokens),
      cw: num(u.cache_creation_input_tokens),
      cr: num(u.cache_read_input_tokens),
      cw1h: num(u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens),
      ws: num(u.server_tool_use && u.server_tool_use.web_search_requests),
    };
    const prev = byId.get(rec.id);
    if (!prev || rec.out >= prev.out) byId.set(rec.id, rec);
  }
  return { messages: [...byId.values()], first, last, branch };
}

const FIELDS = ['in', 'out', 'cw', 'cr', 'cw1h', 'ws'];

/**
 * Turn each message into the usage not yet recorded for it. `recent` maps
 * message id -> [in,out,cw,cr,cw1h,ws] already counted (mutated in place), so
 * a message straddling two hook runs, or re-read after a reset, is never
 * double counted. Returns deltas carrying the full request's prompt size.
 */
function diffAgainst(messages, recent) {
  const deltas = [];
  for (const m of messages) {
    const prev = recent[m.id] || [];
    const d = { ...m, prompt: m.in + m.cw + m.cr };
    let any = false;
    FIELDS.forEach((f, i) => {
      d[f] = Math.max(0, m[f] - (prev[i] || 0));
      if (d[f]) any = true;
    });
    delete recent[m.id]; // re-insert so trimRecent keeps the most recently seen ids
    recent[m.id] = FIELDS.map((f, i) => Math.max(m[f], prev[i] || 0));
    if (any) deltas.push(d);
  }
  return deltas;
}

/** Keep only the newest `max` ids (insertion order) of a recent-usage map. */
function trimRecent(recent, max = 400) {
  const keys = Object.keys(recent);
  if (keys.length <= max) return recent;
  const out = {};
  for (const k of keys.slice(keys.length - max)) out[k] = recent[k];
  return out;
}

/**
 * Collapse message deltas into one row per (model, speed), as the `turn`
 * event wants. costFn(model, usage, speed, promptTokens) prices each request.
 */
function groupByModel(deltas, costFn) {
  const rows = new Map();
  for (const d of deltas) {
    const key = d.model + '|' + (d.speed || '');
    let r = rows.get(key);
    if (!r) {
      r = { model: d.model, speed: d.speed, effort: null, ts: null, in: 0, out: 0, cw: 0, cr: 0, cw1h: 0, ws: 0, req: 0, usd: 0, unpriced: false };
      rows.set(key, r);
    }
    for (const f of FIELDS) r[f] += d[f];
    r.req += 1;
    if (d.effort) r.effort = d.effort;
    if (d.ts && (!r.ts || d.ts > r.ts)) r.ts = d.ts;
    const usd = costFn ? costFn(d.model, d, d.speed, d.prompt) : null;
    if (usd == null) r.unpriced = true;
    else r.usd += usd;
  }
  return [...rows.values()];
}

/**
 * Prompts a person typed (used by backfill; live sessions get them from the
 * UserPromptSubmit hook). Newer transcripts tag them origin.kind "human"
 * (typed, queued, accepted suggestions); when a file carries no origin tags,
 * command wrappers ("<command-name>…"), meta entries, compaction summaries
 * and tool results are what get excluded. Returns [{ ts, text, branch }].
 */
function extractPrompts(entries, opts = {}) {
  const users = entries.filter((e) => e && e.type === 'user' && e.message && !e.isSidechain);
  const tagged = users.some((e) => e.origin && e.origin.kind);
  const out = [];
  for (const e of users) {
    if (e.isMeta || e.isCompactSummary) continue;
    if (opts.sessionId && e.sessionId && e.sessionId !== opts.sessionId) continue;
    if (tagged && !(e.origin && e.origin.kind === 'human')) continue;
    const c = e.message.content;
    let text = null;
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c) && !c.some((b) => b && b.type === 'tool_result')) {
      text = c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
    }
    if (!text || !text.trim()) continue;
    if (!tagged && /^\s*<(command-|local-command|bash-|system-reminder)/.test(text)) continue;
    out.push({ ts: e.timestamp, text, branch: typeof e.gitBranch === 'string' && e.gitBranch !== 'HEAD' ? e.gitBranch : null });
  }
  return out;
}

/**
 * Byte offsets where each human prompt's line starts — the turn boundaries a
 * live Stop hook would have cut at. Used by backfill to rebuild per-turn rows.
 */
function promptOffsets(file) {
  const buf = fs.readFileSync(file);
  const lines = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue;
    lines.push({ start, text: buf.toString('utf8', start, i) });
    start = i + 1;
  }
  const entries = lines.map((l) => {
    try {
      return JSON.parse(l.text);
    } catch {
      return null;
    }
  });
  const tagged = entries.some((e) => e && e.type === 'user' && e.origin && e.origin.kind);
  const offsets = [];
  entries.forEach((e, i) => {
    if (e && extractPrompts([e], {}).length && (!tagged || (e.origin && e.origin.kind === 'human'))) offsets.push(lines[i].start);
  });
  return offsets;
}

/** Transcript file for a subagent, derived from the main transcript path. */
function subagentTranscript(mainTranscript, sessionId, agentId) {
  return path.join(path.dirname(mainTranscript), sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

/** All subagent transcripts of a session: [{ agentId, file }]. */
function listSubagents(mainTranscript, sessionId) {
  const dir = path.join(path.dirname(mainTranscript), sessionId, 'subagents');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => /^agent-(.+)\.jsonl$/.exec(n))
    .filter(Boolean)
    .map((m) => ({ agentId: m[1], file: path.join(dir, m[0]) }));
}

/** agentType from agent-<id>.meta.json, if the file exists. */
function subagentType(transcriptFile) {
  try {
    const meta = JSON.parse(fs.readFileSync(transcriptFile.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    return typeof meta.agentType === 'string' ? meta.agentType : null;
  } catch {
    return null;
  }
}

module.exports = {
  readIncrement,
  parseLines,
  extractMessages,
  diffAgainst,
  trimRecent,
  groupByModel,
  extractPrompts,
  promptOffsets,
  subagentTranscript,
  listSubagents,
  subagentType,
};
