'use strict';
// Optional secondary source: Claude Code's OpenTelemetry `claude_code.api_request`
// log events, read from an OTLP/JSON export (e.g. the collector's file
// exporter: one {"resourceLogs":[...]} document per line).
//
// Hooks stay the primary source. To never double count, OTel only fills what
// the transcript cannot show:
//  - background requests (compaction, titles, ... — any query_source other
//    than the main thread or a subagent) of sessions the hooks did record;
//  - every request of a session that belongs to this repo but has no hook
//    turn data (hook failures, transcripts cleaned up before processing).
// Sessions unknown to this repo are skipped unless allSessions is set, since
// OTel events carry no repository. Imported request ids are remembered per
// clone, so re-importing an overlapping export is harmless.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { loadPricing, cost, round } = require('./pricing');

function attrValue(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('boolValue' in v) return Boolean(v.boolValue);
  return undefined;
}

function attrs(list) {
  const out = {};
  for (const a of list || []) out[a.key] = attrValue(a.value);
  return out;
}

/** api_request records from OTLP/JSON text (NDJSON of export requests, or one document). */
function parseOtlp(text) {
  const docs = [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    docs.push(JSON.parse(trimmed));
  } catch {
    for (const line of trimmed.split('\n')) {
      try {
        if (line.trim()) docs.push(JSON.parse(line));
      } catch {
        // skip non-JSON lines (collector logs mixed into the file)
      }
    }
  }
  const records = [];
  for (const doc of docs) {
    for (const rl of doc.resourceLogs || []) {
      const res = attrs(rl.resource && rl.resource.attributes);
      for (const sl of rl.scopeLogs || []) {
        for (const lr of sl.logRecords || []) {
          const a = { ...res, ...attrs(lr.attributes) };
          const body = lr.body && attrValue(lr.body);
          if (a['event.name'] !== 'api_request' && body !== 'claude_code.api_request') continue;
          const nano = lr.timeUnixNano || lr.observedTimeUnixNano;
          const ts = a['event.timestamp'] || (nano ? new Date(Number(BigInt(nano) / 1000000n)).toISOString() : null);
          records.push({
            ts,
            session: a['session.id'] || null,
            model: a.model || null,
            email: a['user.email'] || null,
            in: Math.max(0, Math.round(a.input_tokens || 0)),
            out: Math.max(0, Math.round(a.output_tokens || 0)),
            cr: Math.max(0, Math.round(a.cache_read_tokens || 0)),
            cw: Math.max(0, Math.round(a.cache_creation_tokens || 0)),
            speed: a.speed === 'fast' ? 'fast' : null,
            effort: typeof a.effort === 'string' ? a.effort : null,
            querySource: a.query_source || null,
            requestId: a.request_id || a.client_request_id || null,
          });
        }
      }
    }
  }
  return records;
}

/** Requests the transcript already shows: the main thread and subagents. */
function inTranscript(querySource) {
  if (!querySource) return true;
  return querySource === 'repl_main_thread' || querySource.startsWith('agent:') || querySource.startsWith('agent_');
}

function recordId(r) {
  return r.requestId || crypto.createHash('sha1').update([r.session, r.ts, r.model, r.in, r.out, r.cr, r.cw].join('|')).digest('hex').slice(0, 20);
}

/**
 * Import api_request records for `dev` into the clone's spool.
 * Returns counts plus the events (written unless dryRun).
 */
function ingest(repo, file, { dev, allSessions = false, dryRun = false } = {}) {
  const records = parseOtlp(fs.readFileSync(file, 'utf8'));
  const events = store.readAllEvents(repo);
  const known = new Set(events.map((e) => e.session).filter(Boolean));
  const covered = new Set(events.filter((e) => e.t === 'turn' && e.src !== 'otel').map((e) => e.session));
  const ledgerFile = path.join(store.localDir(repo), 'otel-ingested.json');
  const ledger = store.readJson(ledgerFile, {});
  const pricing = loadPricing(repo.root);
  const counts = { records: records.length, imported: 0, otherDev: 0, unknownSession: 0, inTranscript: 0, duplicate: 0 };
  const groups = new Map();
  for (const r of records) {
    if (!r.session || !r.model || !r.ts) continue;
    const owner = r.email ? store.sanitizeDev(r.email.split('@')[0]) : dev;
    if (owner !== dev) {
      counts.otherDev++;
      continue;
    }
    if (!known.has(r.session) && !allSessions) {
      counts.unknownSession++;
      continue;
    }
    if (covered.has(r.session) && inTranscript(r.querySource)) {
      counts.inTranscript++;
      continue;
    }
    const id = recordId(r);
    if (ledger[id]) {
      counts.duplicate++;
      continue;
    }
    ledger[id] = r.ts.slice(0, 10);
    counts.imported++;
    // one turn row per session, model, speed, query source and hour
    const key = [r.session, r.model, r.speed || '', r.querySource || '', r.ts.slice(0, 13)].join('|');
    let g = groups.get(key);
    if (!g) {
      g = { t: 'turn', ts: r.ts, dev, session: r.session, agent: 'main', agent_type: null, model: r.model, in: 0, out: 0, cw: 0, cr: 0, usd: 0, task: null, branch: null, dur_ms: 0, req: 0, src: 'otel', qs: r.querySource || null, unpriced: false };
      if (r.speed) g.speed = r.speed;
      groups.set(key, g);
    }
    g.in += r.in;
    g.out += r.out;
    g.cw += r.cw;
    g.cr += r.cr;
    g.req += 1;
    if (r.ts > g.ts) g.ts = r.ts;
    if (r.effort) g.effort = r.effort;
    const usd = cost(pricing, r.model, r, r.speed);
    if (usd == null) g.unpriced = true;
    else g.usd += usd;
  }
  const out = [...groups.values()].map(({ unpriced, ...g }) => ({ ...g, usd: unpriced ? null : round(g.usd) }));
  if (!dryRun && out.length) {
    store.appendEvents(repo, out);
    const cutoff = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    for (const [k, day] of Object.entries(ledger)) if (day < cutoff) delete ledger[k];
    store.writeJsonAtomic(ledgerFile, ledger);
  }
  return { ...counts, rows: out.length, events: out };
}

module.exports = { parseOtlp, ingest, inTranscript };
