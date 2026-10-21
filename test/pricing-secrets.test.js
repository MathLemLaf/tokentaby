'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPricing, normalizeModel, lookup, cost } = require('../lib/pricing');
const { redact, scan } = require('../lib/secrets');
const fake = require('./fake-secrets');

const p = loadPricing(null);

test('model ids from every provider normalise to the price key', () => {
  assert.equal(normalizeModel('claude-opus-4-5-20251101'), 'claude-opus-4-5');
  assert.equal(normalizeModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0'), 'claude-sonnet-4-5');
  assert.equal(normalizeModel('claude-opus-4-1@20250805'), 'claude-opus-4-1');
  assert.equal(normalizeModel('anthropic.claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(normalizeModel('claude-opus-4-6[1m]'), 'claude-opus-4-6');
  assert.equal(lookup(p, 'claude-sonnet-4-20250514').key, 'claude-sonnet-4-0');
  assert.equal(lookup(p, 'claude-3-5-haiku-20241022').key, 'claude-3-5-haiku');
  assert.equal(lookup(p, '<synthetic>'), null);
  assert.equal(lookup(p, 'gpt-9'), null);
});

test('cost: 1h vs 5m cache writes and per-model cache-read rates', () => {
  // opus 5.5: $4 in, $20 out, $0.20 cache read; 5m write 1.25x, 1h write 2x
  assert.equal(cost(p, 'claude-opus-5-5', { in: 1e6 }), 4);
  assert.equal(cost(p, 'claude-opus-5-5', { out: 1e6 }), 20);
  assert.equal(cost(p, 'claude-opus-5-5', { cw: 1e6 }), 5);
  assert.equal(cost(p, 'claude-opus-5-5', { cw: 1e6, cw1h: 1e6 }), 8);
  assert.equal(cost(p, 'claude-opus-5-5', { cr: 1e6 }), 0.2);
  // default cache read is 0.1x input
  assert.equal(cost(p, 'claude-sonnet-4-6', { cr: 1e6 }), 0.3);
});

test('cost: long-context tier is decided by the whole request', () => {
  assert.equal(cost(p, 'claude-haiku-5-5', { in: 100000 }), 0.01);
  assert.equal(cost(p, 'claude-haiku-5-5', { in: 100001 }), 0.050001, 'whole prompt at the >100K rate, rounded to 6 places');
  // a delta priced at the full request's size
  assert.equal(cost(p, 'claude-haiku-5-5', { out: 1000 }, null, 150000), 0.0025);
});

test('cost: fast mode, web search, unknown models', () => {
  assert.equal(cost(p, 'claude-opus-5-5', { in: 1e6 }, 'fast'), 8);
  assert.equal(cost(p, 'claude-opus-5-5', { ws: 3 }), 0.03);
  assert.equal(cost(p, 'some-other-model', { in: 1e6 }), null);
});

test('a repo pricing.json overrides and extends the built-in table', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
  fs.mkdirSync(path.join(dir, '.tokentaby'));
  fs.writeFileSync(path.join(dir, '.tokentaby', 'pricing.json'), JSON.stringify({ models: { 'claude-opus-5-5': { input: 1, output: 2 }, 'my-model': { input: 3, output: 3 } }, fx: { INR: 90 } }));
  const t = loadPricing(dir);
  assert.equal(cost(t, 'claude-opus-5-5', { in: 1e6 }), 1);
  assert.equal(cost(t, 'my-model', { out: 1e6 }), 3);
  assert.equal(cost(t, 'claude-sonnet-5-5', { in: 1e6 }), 2, 'built-in models still priced');
  assert.equal(t.fx.INR, 90);
  assert.equal(t.fx.EUR, loadPricing(null).fx.EUR);
});

test('fx table carries exactly the currencies Claude bills in', () => {
  assert.deepEqual(Object.keys(p.fx).sort(), ['EUR', 'INR', 'USD']);
  assert.equal(p.fx.USD, 1);
});

test('secrets are redacted before anything is written', () => {
  const cases = [
    [`deploy with ${fake.aws} now`, 'aws-access-key'],
    [`token ${fake.github}`, 'github-token'],
    [`use ${fake.anthropic}`, 'anthropic-key'],
    [fake.slack, 'slack-token'],
    [fake.jwt, 'jwt'],
    [fake.pgUrl, 'url-credentials'],
    [`set ${fake.passwordAssignment}`, 'credential-assignment'],
    [fake.pem, 'private-key'],
  ];
  for (const [text, name] of cases) {
    const r = redact(text);
    assert.ok(r.hits.includes(name), `${name} should hit`);
    assert.ok(r.text.includes('[REDACTED]'));
    assert.deepEqual(scan(r.text), [], `redacted text must scan clean (${name})`);
  }
  assert.equal(redact(fake.pgUrl).text, fake.pgUrlRedacted);
  assert.equal(redact(fake.passwordAssignment).text, fake.passwordAssignmentRedacted);
  assert.deepEqual(scan('add retry to the webhook handler; the token count is 4000'), []);
});
