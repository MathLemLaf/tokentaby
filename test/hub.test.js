'use strict';
// Mode hub : un dépôt central reçoit l'usage de tous les dossiers, classé par
// sphère / application / type selon .tokentaby/spheres.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { compile, displayPath } = require('../lib/classify');

const ROOT = path.resolve(__dirname, '..');
const COLLECT = path.join(ROOT, 'hooks', 'collect.js');
const CLI = path.join(ROOT, 'scripts', 'tokentaby.js');
const FIX = path.join(__dirname, 'fixtures');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentaby-hub-'));
const hubDir = path.join(home, 'dev', 'tokentaby-data');
const appDir = path.join(home, 'dev', 'agile-lafond', 'planif');
const lifeDir = path.join(home, 'vie', 'Investissement');
const privDir = path.join(home, 'Documents', 'prive', 'journal');
const projects = path.join(home, '.claude', 'projects');

const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: path.join(home, 'plugin-data'), GIT_CONFIG_NOSYSTEM: '1' };
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_PLUGIN_OPTION_') || k.startsWith('TOKENTABY_')) delete env[k];
env.CLAUDE_PLUGIN_OPTION_DEV_ID = 'math';
Object.assign(env, { GIT_AUTHOR_NAME: 'Math', GIT_AUTHOR_EMAIL: 'math@example.com', GIT_COMMITTER_NAME: 'Math', GIT_COMMITTER_EMAIL: 'math@example.com' });

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { cwd: opts.cwd || home, env, encoding: 'utf8', input: opts.input });
  if (opts.check !== false && r.status !== 0) throw new Error(`${args.join(' ')} → ${r.status}: ${r.stderr}${r.stdout}`);
  return r;
}
const cli = (...args) => run([CLI, ...args]);
const sh = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });

/** Une session Claude Code complète (SessionStart → prompt → Stop → SessionEnd) lancée dans `cwd`. */
function session(id, cwd) {
  const slug = path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-');
  const dir = path.join(projects, slug);
  fs.mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, `${id}.jsonl`);
  const text = fs.readFileSync(path.join(FIX, 'main-session.jsonl'), 'utf8').replace(/sess-0001/g, id).replace(/"cwd":"\/repo"/g, `"cwd":${JSON.stringify(cwd)}`);
  fs.writeFileSync(transcript, text);
  const hook = (p) => run([COLLECT], { cwd, input: JSON.stringify({ session_id: id, transcript_path: transcript, cwd, ...p }) });
  hook({ hook_event_name: 'SessionStart', source: 'startup' });
  hook({ hook_event_name: 'UserPromptSubmit', prompt: `travail dans ${path.basename(cwd)}` });
  hook({ hook_event_name: 'Stop' });
  return transcript;
}

const spool = () =>
  fs
    .readFileSync(path.join(hubDir, '.git', 'tokentaby', 'spool.ndjson'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

test.before(() => {
  for (const d of [appDir, lifeDir, privDir]) fs.mkdirSync(d, { recursive: true });
  sh('git', ['init', '-q', '-b', 'main'], appDir);
  sh('git', ['checkout', '-q', '-b', 'feat/export'], appDir);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('classify : motifs, captures, ignore et défaut', () => {
  const c = compile({
    rules: [
      { match: '~/dev/agile-lafond/*', sphere: 'Dev', app: '{1}', kind: 'développement' },
      { match: '~/vie/*', sphere: '{1}', kind: 'vie perso' },
      { match: '~/Documents/prive/**', ignore: true },
    ],
  });
  assert.deepEqual(c('~/dev/agile-lafond/planif'), { sphere: 'Dev', app: 'planif', kind: 'développement', rule: '~/dev/agile-lafond/*' });
  assert.equal(c('~/dev/agile-lafond/planif/src').app, 'planif', 'un motif couvre les sous-dossiers');
  assert.equal(c('~/vie/Investissement').sphere, 'Investissement');
  assert.equal(c('~/vie/Investissement').app, 'Investissement');
  assert.equal(c('~/Documents/prive/journal').ignore, true);
  assert.equal(c('~/ailleurs/projet').sphere, 'Non classé');
  assert.equal(c('~/ailleurs/projet').app, 'projet');
  assert.equal(displayPath(path.join(os.homedir(), 'dev', 'x')), '~/dev/x');
});

test('sans hub, un dossier non initialisé est laissé tranquille', () => {
  session('s-avant', appDir);
  assert.equal(fs.existsSync(path.join(appDir, '.git', 'tokentaby')), false);
});

test('hub init crée le dépôt central, les règles et le pointeur', () => {
  const r = cli('hub', 'init', '~/dev/tokentaby-data', '--push');
  assert.match(r.stdout, /Hub prêt/);
  assert.ok(fs.existsSync(path.join(hubDir, '.tokentaby', 'spheres.json')));
  assert.equal(fs.readFileSync(path.join(home, '.tokentaby-hub'), 'utf8').trim(), hubDir);
  const cfg = JSON.parse(fs.readFileSync(path.join(hubDir, '.tokentaby', 'config.json'), 'utf8'));
  assert.equal(cfg.sync, 'auto-commit');
  assert.equal(cfg.push, true);
  // règles adaptées au test
  fs.writeFileSync(
    path.join(hubDir, '.tokentaby', 'spheres.json'),
    JSON.stringify({
      rules: [
        { match: '~/dev/agile-lafond/*', sphere: 'Dev', app: '{1}', kind: 'développement' },
        { match: '~/vie/*', sphere: '{1}', app: '{name}', kind: 'vie perso' },
        { match: '~/Documents/prive/**', ignore: true },
      ],
    })
  );
});

test('les sessions de tous les dossiers arrivent dans le hub, étiquetées', () => {
  session('s-dev', appDir);
  session('s-vie', lifeDir);
  session('s-prive', privDir);
  const ev = spool();
  const projs = new Set(ev.map((e) => e.proj));
  assert.ok(projs.has('~/dev/agile-lafond/planif'));
  assert.ok(projs.has('~/vie/Investissement'));
  assert.ok(!projs.has('~/Documents/prive/journal'), 'dossier exclu : rien enregistré');
  const turn = ev.find((e) => e.t === 'turn' && e.session === 's-dev');
  assert.ok(turn, 'des tours sont enregistrés');
  const start = (id) => ev.find((e) => e.t === 'session' && e.event === 'start' && e.session === id);
  assert.equal(start('s-dev').branch, 'feat/export', 'la branche vient du projet, pas du hub');
  assert.equal(start('s-vie').branch, null, 'dossier hors git : pas de branche');
  assert.ok(!fs.existsSync(path.join(appDir, '.git', 'tokentaby')), 'rien écrit dans le projet');
});

test('requêtes : répartition par sphère et filtres', () => {
  const sp = JSON.parse(cli('query', 'spheres', '--from', '2026-01-01', '--to', '2026-12-31').stdout);
  const names = sp.bySphere.map((s) => s.sphere).sort();
  assert.deepEqual(names, ['Dev', 'Investissement']);
  const dev = sp.bySphere.find((s) => s.sphere === 'Dev');
  assert.equal(dev.apps[0].app, 'planif');
  assert.ok(dev.usd > 0);
  const only = JSON.parse(cli('query', 'summary', '--from', '2026-01-01', '--to', '2026-12-31', '--sphere', 'Investissement').stdout);
  assert.ok(Math.abs(only.totals.usd - sp.bySphere.find((s) => s.sphere === 'Investissement').usd) < 1e-9);
  const kinds = JSON.parse(cli('query', 'summary', '--from', '2026-01-01', '--to', '2026-12-31', '--kind', 'vie perso').stdout);
  assert.equal(kinds.totals.usd, only.totals.usd);
  const rules = cli('hub', 'rules').stdout;
  assert.match(rules, /~\/vie\/Investissement\s+Investissement/);
});

test("reclasser : changer une règle change tout l'historique", () => {
  const f = path.join(hubDir, '.tokentaby', 'spheres.json');
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  cfg.rules[1] = { match: '~/vie/*', sphere: 'Finances', app: '{1}', kind: 'vie perso' };
  fs.writeFileSync(f, JSON.stringify(cfg));
  const sp = JSON.parse(cli('query', 'spheres', '--from', '2026-01-01', '--to', '2026-12-31').stdout);
  assert.ok(sp.bySphere.some((s) => s.sphere === 'Finances'));
});

test("backfill en mode hub importe l'historique de tous les dossiers", () => {
  // une ancienne session jamais vue par les hooks, dans un autre dossier
  const old = path.join(home, 'dev', 'genealogie');
  fs.mkdirSync(old, { recursive: true });
  const slug = path.resolve(old).replace(/[^A-Za-z0-9]/g, '-');
  fs.mkdirSync(path.join(projects, slug), { recursive: true });
  const text = fs.readFileSync(path.join(FIX, 'main-session.jsonl'), 'utf8').replace(/sess-0001/g, 's-old').replace(/"cwd":"\/repo"/g, `"cwd":${JSON.stringify(old)}`);
  const file = path.join(projects, slug, 's-old.jsonl');
  fs.writeFileSync(file, text);
  fs.utimesSync(file, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  const r = cli('backfill', '--json');
  const t = JSON.parse(r.stdout);
  assert.ok(t.dirs >= 4);
  assert.ok(t.imported >= 1);
  const ev = spool();
  assert.ok(ev.some((e) => e.session === 's-old' && e.proj === '~/dev/genealogie' && e.t === 'turn'));
  assert.ok(!ev.some((e) => e.session === 's-avant' && e.proj === '~/Documents/prive/journal'));
  // un second passage n'ajoute rien
  const again = JSON.parse(cli('backfill', '--json').stdout);
  assert.equal(again.turnRows, 0);
});

test('summary affiche la répartition par sphère ; sync commit dans le hub', () => {
  const out = cli('summary').stdout;
  assert.match(out, /par sphère/);
  const s = cli('sync').stdout;
  assert.match(s, /Committed usage/);
  const log = sh('git', ['log', '--oneline'], hubDir).stdout;
  assert.match(log, /chore\(usage\): math/);
  const h = run([CLI, 'hub', 'sync'], { check: false });
  assert.match(h.stdout + h.stderr, /remote/);
});
