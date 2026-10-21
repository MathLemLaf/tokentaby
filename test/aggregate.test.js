'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Dataset, dayOf, toCsv } = require('../lib/aggregate');
const { squash } = require('../lib/rollup');
const { lineErrors, devsForEmail } = require('../lib/validate');
const { ticketFromBranch, parseTaskCommand, resolveTask } = require('../lib/tasks');

const T = (o) => ({ v: 1, t: 'turn', session: 's1', agent: 'main', agent_type: null, model: 'claude-opus-5-5', in: 10, out: 100, cw: 0, cr: 1000, usd: 1, task: null, branch: 'main', dur_ms: 1000, req: 1, ...o });

function events() {
  return [
    { v: 1, t: 'session', ts: '2026-10-20T09:00:00Z', dev: 'sami', session: 's1', event: 'start' },
    { v: 1, t: 'prompt', ts: '2026-10-20T09:00:01Z', dev: 'sami', session: 's1', task: 'TKT-1', hash: 'aaa', chars: 10, text: 'add retry' },
    T({ ts: '2026-10-20T09:00:30Z', dev: 'sami', usd: 2, task: 'TKT-1' }),
    T({ ts: '2026-10-20T09:00:31Z', dev: 'sami', agent: 'ag1', agent_type: 'Explore', model: 'claude-haiku-5-5', usd: 0.5, task: 'TKT-1' }),
    { v: 1, t: 'prompt', ts: '2026-10-20T09:05:00Z', dev: 'sami', session: 's1', task: 'TKT-1', hash: 'bbb', chars: 20, text: 'now write tests' },
    T({ ts: '2026-10-20T09:06:00Z', dev: 'sami', model: 'claude-sonnet-5-5', usd: 1, task: 'TKT-1' }),
    T({ ts: '2026-10-21T11:00:00Z', dev: 'rafi', session: 's2', usd: 4, task: 'TKT-2', branch: 'feat/TKT-2' }),
    T({ ts: '2026-10-21T11:00:00Z', dev: 'rafi', session: 's2', model: 'mystery-model', usd: null }),
    { v: 1, t: 'task', ts: '2026-10-21T11:30:00Z', dev: 'rafi', session: 's2', task: 'TKT-2', status: 'done', title: 'Webhook retry' },
  ];
}

const ds = () => new Dataset(events(), { me: 'sami', names: { rafi: { name: 'Rafi H.' } } });
const R = { from: '2026-10-01', to: '2026-10-31' };

test('summary totals, me vs team, shares and unpriced tokens', () => {
  const s = ds().summary(R);
  assert.equal(s.totals.usd, 7.5, 'the unpriced row adds tokens, not dollars');
  assert.equal(s.totals.sessions, 2);
  assert.equal(s.totals.prompts, 2);
  assert.equal(s.totals.devs, 2);
  assert.equal(s.totals.unpricedTokens, 1110);
  assert.equal(s.me.usd, 3.5);
  assert.equal(s.byModel[0].model, 'claude-opus-5-5');
  assert.deepEqual(s.byAgent.map((a) => a.type), ['main', 'Explore']);
  assert.equal(s.topDevs[0].name, 'Rafi H.');
  assert.equal(s.byDay.length, 31);
  assert.equal(s.trend.length, 30);
  assert.equal(s.prev.days, 31);
});

test('devs: favourite model, subagent share', () => {
  const sami = ds().devs(R).find((d) => d.dev === 'sami');
  assert.equal(sami.subShare, Number((0.5 / 3.5).toFixed(6)));
  assert.equal(sami.prompts, 2);
  assert.equal(sami.sessions, 1);
});

test('prompts are attributed to the model that answered them', () => {
  const log = ds().promptLog(R);
  assert.equal(log.total, 2);
  const byHash = Object.fromEntries(log.items.map((p) => [p.hash, p.model]));
  assert.equal(byHash.aaa, 'claude-opus-5-5');
  assert.equal(byHash.bbb, 'claude-sonnet-5-5');
  assert.equal(ds().promptLog({ ...R, q: 'tests' }).total, 1);
});

test('tasks carry titles/status and branch economics', () => {
  const { tasks, branches } = ds().tasks(R);
  const t2 = tasks.find((t) => t.task === 'TKT-2');
  assert.equal(t2.status, 'done');
  assert.equal(t2.title, 'Webhook retry');
  const t1 = tasks.find((t) => t.task === 'TKT-1');
  assert.equal(t1.prompts, 2);
  assert.equal(t1.usd, 3.5);
  assert.ok(branches.some((b) => b.branch === 'feat/TKT-2'));
});

test('agents: overhead and per-session split', () => {
  const a = ds().agents(R);
  assert.equal(a.sessions[0].agents, 1);
  assert.equal(a.sessions[0].subUsd, 0.5);
  assert.equal(a.overhead, Number((0.5 / 7.5).toFixed(6)));
});

test('rollup rows aggregate like the raw events they replace', () => {
  const raw = events();
  const rolled = squash(raw.filter((e) => e.dev === 'sami'));
  const before = new Dataset(raw.filter((e) => e.dev === 'sami')).summary(R).totals;
  const after = new Dataset(rolled).summary(R).totals;
  assert.equal(after.usd, before.usd);
  assert.equal(after.tokens, before.tokens);
  assert.equal(after.sessions, before.sessions);
  assert.equal(after.prompts, before.prompts);
  for (const r of rolled) assert.deepEqual(lineErrors(r, null), [], JSON.stringify(r));
});

test('schema validation catches bad lines and foreign dev dirs', () => {
  assert.deepEqual(lineErrors(T({ ts: '2026-10-20T09:00:30Z', dev: 'sami' }), 'sami'), []);
  assert.ok(lineErrors(T({ ts: 'yesterday', dev: 'sami' }), 'sami').some((e) => e.includes('timestamp')));
  assert.ok(lineErrors(T({ ts: '2026-10-20T09:00:30Z', dev: 'rafi' }), 'sami').some((e) => e.includes('devs/sami')));
  assert.ok(lineErrors(T({ ts: '2026-10-20T09:00:30Z', dev: 'sami', in: -1 }), 'sami').length);
  assert.ok(lineErrors({ v: 1, t: 'nope' }, null).length);
  assert.ok(devsForEmail('ghost@users.noreply.github.com', { sami: { emails: ['ghost@users.noreply.github.com'] } }).has('sami'));
});

test('task resolution order', () => {
  assert.equal(ticketFromBranch('feat/TKT-142-retry'), 'TKT-142');
  assert.equal(ticketFromBranch('release-2026'), null);
  assert.equal(parseTaskCommand('/tokentaby:task TKT-9'), 'TKT-9');
  assert.equal(parseTaskCommand('/tokentaby:task none'), null);
  assert.equal(parseTaskCommand('/tt task TKT-9'), undefined, 'plugin commands always carry the plugin prefix');
  assert.equal(parseTaskCommand('please add a task list'), undefined);
  assert.equal(resolveTask({ session: { task: 'X-1' }, branch: 'feat/TKT-2' }), 'X-1');
  assert.equal(resolveTask({ clone: { id: 'C-1', branch: 'feat/TKT-2' }, branch: 'feat/TKT-2' }), 'C-1');
  assert.equal(resolveTask({ clone: { id: 'C-1', branch: 'other' }, branch: 'feat/TKT-2' }), 'TKT-2');
  assert.equal(resolveTask({ session: { claudeTask: 'Fix login' }, branch: 'main' }), 'Fix login');
});

test('csv export escapes values', () => {
  assert.equal(toCsv([{ a: 'x,y', b: 'say "hi"' }], ['a', 'b']), 'a,b\n"x,y","say ""hi"""\n');
  assert.equal(dayOf('not a date'), null);
});
