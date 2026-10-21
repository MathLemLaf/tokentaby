'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ta = require('../lib/transcript-adapter');
const { loadPricing, cost } = require('../lib/pricing');

const FIX = path.join(__dirname, 'fixtures');
const MAIN = path.join(FIX, 'main-session.jsonl');
const SESSION = 'sess-0001';

test('readIncrement returns only complete lines and a resumable offset', () => {
  const inc = ta.readIncrement(MAIN, 0);
  const size = fs.statSync(MAIN).size;
  assert.ok(inc.end < size, 'the unterminated last entry is left for later');
  assert.ok(inc.text.endsWith('\n'));
  assert.equal(ta.readIncrement(MAIN, inc.end), null, 'nothing new until the line is finished');
});

test('readIncrement rereads a file that shrank (rewritten transcript)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
  const f = path.join(dir, 't.jsonl');
  fs.writeFileSync(f, '{"a":1}\n');
  const inc = ta.readIncrement(f, 500);
  assert.equal(inc.reset, true);
  assert.equal(inc.end, 8);
});

test('extractMessages dedupes per message id and skips synthetic and copied entries', () => {
  const entries = ta.parseLines(ta.readIncrement(MAIN, 0).text);
  const b = ta.extractMessages(entries, { sessionId: SESSION });
  assert.deepEqual(b.messages.map((m) => m.id).sort(), ['msg_A', 'msg_B', 'msg_C']);
  const a = b.messages.find((m) => m.id === 'msg_A');
  assert.deepEqual([a.in, a.out, a.cw, a.cr, a.cw1h], [2, 300, 1000, 20000, 1000], 'counted once despite 3 block entries');
  assert.equal(a.effort, 'high');
  assert.equal(b.branch, 'feat/TKT-142-retry');
  assert.equal(b.first, '2026-10-20T09:00:00.000Z', 'timestamps span every entry read');
});

test('minTs drops history a resumed/forked session was seeded with', () => {
  const entries = ta.parseLines(ta.readIncrement(MAIN, 0).text);
  const b = ta.extractMessages(entries, { minTs: '2026-10-21T10:00:15.000Z' });
  assert.deepEqual(b.messages.map((m) => m.id), ['msg_C']);
});

test('diffAgainst counts growth only and is idempotent', () => {
  const recent = {};
  const m = { id: 'x', model: 'claude-opus-5-5', in: 1, out: 10, cw: 0, cr: 100, cw1h: 0, ws: 0 };
  assert.equal(ta.diffAgainst([m], recent)[0].out, 10);
  assert.equal(ta.diffAgainst([m], recent).length, 0, 'same usage seen again: nothing new');
  const grown = ta.diffAgainst([{ ...m, out: 25 }], recent);
  assert.equal(grown.length, 1);
  assert.equal(grown[0].out, 15);
  assert.equal(grown[0].cr, 0);
  assert.equal(grown[0].prompt, 101, 'delta keeps the full request size for long-context pricing');
});

test('trimRecent keeps the newest ids', () => {
  const r = {};
  for (let i = 0; i < 10; i++) r['m' + i] = [i];
  assert.deepEqual(Object.keys(ta.trimRecent(r, 3)), ['m7', 'm8', 'm9']);
});

test('groupByModel produces one priced row per model', () => {
  const entries = ta.parseLines(ta.readIncrement(MAIN, 0).text);
  const b = ta.extractMessages(entries, { sessionId: SESSION });
  const p = loadPricing(null);
  const rows = ta.groupByModel(ta.diffAgainst(b.messages, {}), (m, u, s, pt) => cost(p, m, u, s, pt));
  const opus = rows.find((r) => r.model === 'claude-opus-5-5');
  const sonnet = rows.find((r) => r.model === 'claude-sonnet-5-5');
  assert.equal(opus.req, 2);
  assert.equal(opus.out, 420);
  assert.equal(Number(opus.usd.toFixed(6)), 0.02562);
  assert.equal(Number(sonnet.usd.toFixed(6)), 0.00151);
  assert.equal(opus.ts, '2026-10-21T10:00:11.000Z');
});

test('subagent transcripts are found and typed from their meta file', () => {
  const list = ta.listSubagents(MAIN, SESSION);
  assert.deepEqual(list.map((s) => s.agentId), ['agent01']);
  assert.equal(ta.subagentType(list[0].file), 'Explore');
  assert.equal(ta.subagentTranscript(MAIN, SESSION, 'agent01'), list[0].file);
  const b = ta.extractMessages(ta.parseLines(ta.readIncrement(list[0].file, 0).text), { sessionId: SESSION });
  assert.equal(b.messages.length, 2);
  assert.equal(b.messages[0].agentType, 'Explore');
});
