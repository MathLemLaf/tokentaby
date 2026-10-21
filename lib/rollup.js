'use strict';
// Monthly rollup: squashes old devs/<dev>/<YYYY-MM>.ndjson logs into one
// .tokentaby/rollups/<YYYY-MM>.ndjson of daily aggregates, so the repo and
// the dashboard's load time stay small. Turn rows become per-day sums by
// (dev, model, agent, task, branch, speed); session starts become counts;
// prompts are kept verbatim unless dropPrompts asks for per-day counts.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const { dayOf } = require('./aggregate');
const { round } = require('./pricing');

/** Default cutoff: months before last month (late branches may still add to last month). */
function defaultBefore(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Rows for one month's raw events. */
function squash(events, { dropPrompts = false } = {}) {
  const turns = new Map();
  const prompts = new Map();
  const sessions = new Map();
  const kept = [];
  for (const e of events) {
    if (e.t === 'turn') {
      const day = dayOf(e.ts);
      const sub = e.agent && e.agent !== 'main';
      const key = [day, e.dev, e.model, sub ? 'sub' : 'main', sub ? e.agent_type || '' : '', e.task || '', e.branch || '', e.speed || ''].join('\u0000');
      let r = turns.get(key);
      if (!r) {
        r = { v: store.SCHEMA_VERSION, t: 'rollup', k: 'turn', day, dev: e.dev, model: e.model, agent: sub ? 'sub' : 'main', agent_type: sub ? e.agent_type || null : null, task: e.task || null, branch: e.branch || null, in: 0, out: 0, cw: 0, cr: 0, cw1h: 0, ws: 0, req: 0, usd: 0, dur_ms: 0, n: 0, agents: 0, ids: new Set(), unpriced: false };
        if (e.speed) r.speed = e.speed;
        turns.set(key, r);
      }
      for (const k of ['in', 'out', 'cw', 'cr', 'cw1h', 'ws', 'dur_ms']) r[k] += e[k] || 0;
      r.req += e.req || 1;
      r.n += 1;
      if (typeof e.usd === 'number') r.usd += e.usd;
      else r.unpriced = true;
      if (sub) r.ids.add(e.agent);
    } else if (e.t === 'prompt' && dropPrompts) {
      const day = dayOf(e.ts);
      const key = [day, e.dev, e.task || ''].join('\u0000');
      const r = prompts.get(key) || { v: store.SCHEMA_VERSION, t: 'rollup', k: 'prompt', day, dev: e.dev, task: e.task || null, n: 0, chars: 0 };
      r.n += 1;
      r.chars += e.chars || 0;
      prompts.set(key, r);
    } else if (e.t === 'session') {
      if (e.event !== 'start') continue;
      const day = dayOf(e.ts);
      const key = [day, e.dev].join('\u0000');
      const r = sessions.get(key) || { v: store.SCHEMA_VERSION, t: 'rollup', k: 'session', day, dev: e.dev, n: 0 };
      r.n += 1;
      sessions.set(key, r);
    } else if (e.t === 'prompt' || e.t === 'task') {
      kept.push(e);
    }
  }
  const turnRows = [...turns.values()].map(({ ids, unpriced, ...r }) => {
    r.agents = ids.size;
    r.usd = unpriced && !r.usd ? null : round(r.usd);
    if (!r.cw1h) delete r.cw1h;
    if (!r.ws) delete r.ws;
    return r;
  });
  const byDay = (a, b) => ((a.day || a.ts) < (b.day || b.ts) ? -1 : (a.day || a.ts) > (b.day || b.ts) ? 1 : 0);
  return [...turnRows, ...prompts.values(), ...sessions.values()].sort(byDay).concat(kept.sort((a, b) => (a.ts < b.ts ? -1 : 1)));
}

/**
 * Roll up every dev log older than `before` (YYYY-MM, exclusive).
 * Returns { months: { 'YYYY-MM': { files, events, rows } }, removed: [...] }.
 */
function rollup(repo, { before = defaultBefore(), dropPrompts = false, dryRun = false } = {}) {
  const root = repo.root;
  const devsDir = path.join(root, '.tokentaby', 'devs');
  const byMonth = new Map();
  for (const dev of safeReaddir(devsDir)) {
    for (const f of safeReaddir(path.join(devsDir, dev))) {
      const m = /^(\d{4}-\d{2})\.ndjson$/.exec(f);
      if (!m || m[1] >= before) continue;
      if (!byMonth.has(m[1])) byMonth.set(m[1], []);
      byMonth.get(m[1]).push(`.tokentaby/devs/${dev}/${f}`);
    }
  }
  const report = { before, months: {}, removed: [] };
  for (const [month, files] of [...byMonth].sort()) {
    const events = [];
    for (const rel of files) {
      const seen = new Set();
      for (const line of fs.readFileSync(path.join(root, rel), 'utf8').split('\n')) {
        if (!line.trim() || seen.has(line)) continue;
        seen.add(line);
        try {
          events.push(JSON.parse(line));
        } catch {
          // validate reports corrupt lines; they cannot be rolled up
        }
      }
    }
    const rows = squash(events, { dropPrompts });
    report.months[month] = { files: files.length, events: events.length, rows: rows.length };
    if (dryRun) continue;
    const out = path.join(root, '.tokentaby', 'rollups', `${month}.ndjson`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.appendFileSync(out, rows.map((r) => JSON.stringify(r) + '\n').join(''));
    for (const rel of files) {
      fs.unlinkSync(path.join(root, rel));
      report.removed.push(rel);
    }
  }
  return report;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

module.exports = { rollup, squash, defaultBefore };
