'use strict';
// CI guard: every usage line must parse and match the schema, nobody may add
// lines to another dev's log, and no logged line may look like a credential.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const git = require('./git');
const { scan } = require('./secrets');

const REQUIRED = {
  turn: ['ts', 'dev', 'session', 'agent', 'model', 'in', 'out', 'cw', 'cr'],
  prompt: ['ts', 'dev', 'session', 'hash', 'chars'],
  task: ['ts', 'dev', 'status'],
  session: ['ts', 'dev', 'session', 'event'],
  rollup: ['day', 'dev', 'k'],
};
const COUNTS = ['in', 'out', 'cw', 'cr', 'cw1h', 'ws', 'req', 'dur_ms', 'chars', 'n', 'agents'];

/** Schema problems of one parsed line (empty when valid). dirDev: owner dir for devs/ files. */
function lineErrors(o, dirDev) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['not a JSON object'];
  const errs = [];
  if (!Number.isInteger(o.v) || o.v < 1 || o.v > store.SCHEMA_VERSION) errs.push(`unsupported schema version v=${JSON.stringify(o.v)}`);
  const req = REQUIRED[o.t];
  if (!req) return errs.concat(`unknown event type t=${JSON.stringify(o.t)}`);
  for (const k of req) if (o[k] === undefined || o[k] === null || o[k] === '') errs.push(`missing "${k}"`);
  if (o.ts !== undefined && isNaN(Date.parse(o.ts))) errs.push(`bad timestamp "${o.ts}"`);
  if (o.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(o.day)) errs.push(`bad day "${o.day}"`);
  for (const k of COUNTS) {
    if (o[k] !== undefined && !(Number.isInteger(o[k]) && o[k] >= 0)) errs.push(`"${k}" must be a non-negative integer`);
  }
  if (o.usd !== undefined && o.usd !== null && !(typeof o.usd === 'number' && o.usd >= 0)) errs.push('"usd" must be a non-negative number or null');
  if (o.text !== undefined && typeof o.text !== 'string') errs.push('"text" must be a string');
  if (dirDev && o.dev && store.sanitizeDev(o.dev) !== dirDev) errs.push(`dev "${o.dev}" written into devs/${dirDev}/`);
  return errs;
}

/** Validate every committed log under .tokentaby/. Returns { files, lines, errors: [{ file, line, msg }] }. */
function validateTree(root) {
  const res = { files: 0, lines: 0, errors: [] };
  const check = (rel, dirDev) => {
    res.files++;
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (text && !text.endsWith('\n')) res.errors.push({ file: rel, line: 0, msg: 'file must end with a newline (union merges glue lines otherwise)' });
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      res.lines++;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        res.errors.push({ file: rel, line: i + 1, msg: 'invalid JSON' });
        return;
      }
      for (const msg of lineErrors(o, dirDev)) res.errors.push({ file: rel, line: i + 1, msg });
      const secrets = scan(line);
      if (secrets.length) res.errors.push({ file: rel, line: i + 1, msg: `possible secret (${secrets.join(', ')})` });
    });
  };
  const devs = path.join(root, '.tokentaby', 'devs');
  for (const dev of readdir(devs)) {
    for (const f of readdir(path.join(devs, dev))) if (f.endsWith('.ndjson')) check(`.tokentaby/devs/${dev}/${f}`, dev);
  }
  for (const f of readdir(path.join(root, '.tokentaby', 'rollups'))) if (f.endsWith('.ndjson')) check(`.tokentaby/rollups/${f}`, null);
  return res;
}

/**
 * Dev ids an author email may write to: the email's local part, plus every
 * devs.json entry listing that email (for overridden ids or noreply emails).
 */
function devsForEmail(email, devsJson) {
  const e = String(email || '').toLowerCase();
  const out = new Set([store.sanitizeDev(e.split('@')[0])]);
  for (const [id, info] of Object.entries(devsJson || {})) {
    const emails = (info && Array.isArray(info.emails) ? info.emails : []).map((x) => String(x).toLowerCase());
    if (emails.includes(e)) out.add(store.sanitizeDev(id));
  }
  return out;
}

/**
 * Commits in base..head (merges excluded) that add lines to another dev's
 * log. Deleting whole files (a rollup) is allowed. Returns [{ commit, email, file, msg }].
 */
function ownershipErrors(root, base, head = 'HEAD') {
  const devsJson = store.readJson(path.join(root, '.tokentaby', 'devs.json'), {});
  const list = git.git(['rev-list', '--no-merges', `${base}..${head}`, '--', '.tokentaby/devs/'], root);
  if (!list.ok) throw new Error(`git rev-list ${base}..${head} failed: ${list.stderr.trim()}`);
  const errors = [];
  for (const commit of list.stdout.split('\n').filter(Boolean)) {
    const email = git.git(['show', '-s', '--format=%ae', commit], root).stdout.trim();
    const allowed = devsForEmail(email, devsJson);
    const stat = git.git(['show', '--numstat', '--format=', commit, '--', '.tokentaby/devs/'], root).stdout;
    for (const row of stat.split('\n').filter(Boolean)) {
      const [added, , file] = row.split('\t');
      const dev = (file || '').split('/')[2];
      if (!dev || added === '0' || allowed.has(dev)) continue;
      errors.push({ commit: commit.slice(0, 10), email, file, msg: `adds lines to devs/${dev}/ but the author maps to ${[...allowed].join(', ')}` });
    }
  }
  return errors;
}

function readdir(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

module.exports = { lineErrors, validateTree, ownershipErrors, devsForEmail, REQUIRED };
