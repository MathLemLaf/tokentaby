'use strict';
// Mode hub : un seul dépôt central (privé) reçoit l'usage de TOUS les
// dossiers où Claude Code tourne, au lieu d'un .tokentaby/ par dépôt.
//
// Le hub est choisi par, dans l'ordre :
//   TOKENTABY_HUB (variable d'environnement, pour la CLI et les tests)
//   l'option du plugin `hub` (CLAUDE_PLUGIN_OPTION_HUB)
//   le fichier ~/.tokentaby-hub (une ligne : le chemin du hub)
// Sans hub, tokentaby garde son comportement d'origine (un suivi par dépôt).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const store = require('./store');
const git = require('./git');
const { compile, displayPath } = require('./classify');

const POINTER = () => path.join(os.homedir(), '.tokentaby-hub');

function expand(p) {
  const s = String(p || '').trim();
  if (!s) return null;
  if (s === '~') return os.homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(2));
  return path.resolve(s);
}

/** Chemin absolu du hub configuré, ou null. */
function hubDir() {
  const env = process.env.TOKENTABY_HUB || process.env.CLAUDE_PLUGIN_OPTION_HUB;
  if (env && env.trim()) return expand(env);
  try {
    return expand(fs.readFileSync(POINTER(), 'utf8').split('\n')[0]);
  } catch {
    return null;
  }
}

/** Le dépôt git du hub s'il est configuré ET initialisé, sinon null. */
function hubRepo() {
  const dir = hubDir();
  if (!dir) return null;
  const repo = git.findRepo(dir);
  if (!repo || path.resolve(repo.root) !== path.resolve(dir) || !store.isInitialized(repo.root)) return null;
  return repo;
}

function loadRules(root) {
  return store.readJson(path.join(store.tokentabyDir(root), 'spheres.json'), {});
}

function classifier(root) {
  return compile(loadRules(root));
}

/**
 * Où écrire l'usage d'une session lancée dans `cwd` : le hub, étiqueté avec
 * le dossier du projet (racine git si `cwd` est dans un dépôt, sinon `cwd`).
 * Renvoie { repo, projDir, projRepo, ignored } ou null sans hub.
 */
function resolve(cwd) {
  const hub = hubRepo();
  if (!hub) return null;
  const dir = path.resolve(cwd || process.cwd());
  const projRepo = git.findRepo(dir);
  // le dossier où la session a démarré (épinglé au SessionStart) : un monorepo
  // comme ~/dev/agile-lafond/apps/<app> se classe ainsi par application ;
  // la branche, elle, vient du dépôt git qui le contient
  const projDir = dir;
  const proj = displayPath(projDir);
  const ignored = !!classifier(hub.root)(proj).ignore;
  return { repo: { ...hub, proj }, projDir, projRepo, ignored };
}

/** Le hub a-t-il une remote ? (sinon rien à pousser) */
function hasRemote(repo) {
  const r = git.git(['remote'], repo.root);
  return r.ok && !!r.stdout.trim();
}

/**
 * Synchronise le hub avec GitHub en arrière-plan (pull --rebase puis push),
 * sans jamais bloquer Claude Code. Utilise les identifiants git de la machine.
 */
function pushAsync(repo) {
  if (!hasRemote(repo)) return { pushed: false, reason: 'pas de remote' };
  const script = [
    "const {spawnSync}=require('child_process');",
    'const o={cwd:process.argv[1],stdio:"ignore",timeout:60000};',
    "spawnSync('git',['pull','--rebase','--autostash','-q'],o);",
    "spawnSync('git',['push','-q'],o);",
  ].join('');
  try {
    const child = spawn(process.execPath, ['-e', script, repo.root], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { pushed: true };
  } catch (e) {
    return { pushed: false, reason: String(e.message || e) };
  }
}

/** Synchronise maintenant (CLI) : pull --rebase puis push, résultat détaillé. */
function syncNow(repo) {
  if (!hasRemote(repo)) return { ok: false, reason: "le hub n'a pas de remote GitHub (git remote add origin …)" };
  const pull = git.git(['pull', '--rebase', '--autostash', '-q'], repo.root);
  if (!pull.ok) return { ok: false, reason: (pull.stderr || pull.stdout).trim() };
  const push = git.git(['push', '-q'], repo.root);
  if (!push.ok) return { ok: false, reason: (push.stderr || push.stdout).trim() };
  return { ok: true };
}

module.exports = { hubDir, hubRepo, resolve, classifier, loadRules, pushAsync, syncNow, hasRemote, expand, POINTER };
