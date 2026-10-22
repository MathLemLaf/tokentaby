'use strict';
// Storage: the committed NDJSON event log, the clone-local spool that feeds
// it, watermarks, and dev identity.
//
// Hooks append to a spool inside .git/ (never the working tree), so a Claude
// session never leaves `git status` dirty and never blocks checkout, pull
// --rebase or stash. The spool is moved into .tokentaby/devs/<dev>/<YYYY-MM>.ndjson
// when usage is shipped (pre-commit in ride-along mode, SessionEnd in
// auto-commit mode, /tokentaby:sync in manual mode).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const EVENT_TYPES = ['turn', 'prompt', 'task', 'session', 'rollup'];

// Hooks get CLAUDE_PLUGIN_DATA from Claude Code; the CLI is pointed at the same
// folder (--data-dir, or the path SessionStart saved in the clone's state) so
// live hooks and backfill share one set of watermarks.
let dataDirOverride = null;
const setDataDir = (dir) => {
  dataDirOverride = dir || null;
};
const dataDir = () => dataDirOverride || process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'plugins', 'data', 'tokentaby');

// ---------------------------------------------------------------- files

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Atomic replace: write a temp file next to the target, then rename. */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

/**
 * Run fn while holding an exclusive lock file. Returns undefined without
 * running fn if another process holds a fresh lock (it will do the work).
 */
function withLock(lockFile, fn, staleMs = 30000) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(lockFile, 'wx');
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let age = 0;
    try {
      age = Date.now() - fs.statSync(lockFile).mtimeMs;
    } catch {
      // lock vanished between open and stat: retry once below
    }
    if (age && age < staleMs) return undefined;
    try {
      fs.unlinkSync(lockFile);
      fd = fs.openSync(lockFile, 'wx');
    } catch {
      return undefined;
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // already gone
    }
  }
}

// ---------------------------------------------------------------- repo layout

const tokentabyDir = (root) => path.join(root, '.tokentaby');
const isInitialized = (root) => fs.existsSync(path.join(tokentabyDir(root), 'schema-version'));
const localDir = (repo) => path.join(repo.commonDir, 'tokentaby');
const spoolFile = (repo) => path.join(localDir(repo), 'spool.ndjson');

/** Repo-relative path (forward slashes) of a dev's monthly log for `ts`. */
function monthPath(dev, ts) {
  const month = /^\d{4}-\d{2}/.test(ts || '') ? ts.slice(0, 7) : new Date().toISOString().slice(0, 7);
  return `.tokentaby/devs/${dev}/${month}.ndjson`;
}

// ---------------------------------------------------------------- identity

/** Directory-safe dev id: lowercase, [a-z0-9._-] only. */
function sanitizeDev(s) {
  return (
    String(s || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 64) || 'unknown'
  );
}

/**
 * The developer's id: the dev_id plugin option they chose to share (state.dev
 * is the copy SessionStart saved for the CLI and git hook). Never derived from
 * git user.email or the OS account. null until the developer picks one.
 */
function devIdFor(cfg, state) {
  const id = (cfg && cfg.dev_id) || (state && state.dev);
  return id ? sanitizeDev(id) : null;
}

// ---------------------------------------------------------------- local state (per clone, untracked)

function readState(repo) {
  return readJson(path.join(localDir(repo), 'state.json'), {});
}

function writeState(repo, patch) {
  const next = { ...readState(repo), ...patch, updated: new Date().toISOString() };
  writeJsonAtomic(path.join(localDir(repo), 'state.json'), next);
  if (patch.plugin_root) {
    // plain-text pointer for the POSIX pre-commit hook
    fs.writeFileSync(path.join(localDir(repo), 'plugin-root'), patch.plugin_root + '\n');
  }
  return next;
}

// ---------------------------------------------------------------- events

function stamp(ev) {
  return { v: SCHEMA_VERSION, ...ev };
}

/** Append events to the clone's spool in a single write (O_APPEND keeps concurrent hooks intact). */
function appendEvents(repo, events) {
  if (!events.length) return;
  fs.mkdirSync(localDir(repo), { recursive: true });
  // mode hub : chaque événement garde le dossier du projet d'où il vient
  const tag = (e) => (repo.proj && !e.proj ? { ...e, proj: repo.proj } : e);
  fs.appendFileSync(spoolFile(repo), events.map((e) => JSON.stringify(stamp(tag(e))) + '\n').join(''));
}

/**
 * Move spooled events into the committed monthly logs.
 * The spool is renamed before reading so hooks appending meanwhile start a
 * fresh spool; leftovers from an interrupted flush are picked up too.
 * Returns { files: [repo-relative paths written], count }.
 */
function flushSpool(repo) {
  const res = withLock(path.join(localDir(repo), 'flush.lock'), () => flushUnlocked(repo));
  return res || { files: [], count: 0 };
}

function flushUnlocked(repo) {
  const dir = localDir(repo);
  const spool = spoolFile(repo);
  try {
    fs.renameSync(spool, `${spool}.${process.pid}.${Date.now()}.flushing`);
  } catch {
    // nothing spooled since the last flush
  }
  let pending = [];
  try {
    pending = fs.readdirSync(dir).filter((n) => n.startsWith('spool.ndjson.') && n.endsWith('.flushing'));
  } catch {
    return { files: [], count: 0 };
  }
  const byFile = new Map();
  for (const name of pending.sort()) {
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (!ev.dev) continue;
      const rel = monthPath(sanitizeDev(ev.dev), ev.ts);
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push(line + '\n');
    }
  }
  let count = 0;
  for (const [rel, lines] of byFile) {
    const abs = path.join(repo.root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, lines.join(''));
    count += lines.length;
  }
  for (const name of pending) fs.unlinkSync(path.join(dir, name));
  return { files: [...byFile.keys()].sort(), count };
}

/**
 * Every event visible from this clone: committed logs and rollups for the
 * whole team plus this clone's not-yet-shipped spool. Identical lines within
 * one dev-month (a re-run hook, a union merge) are kept once.
 */
function readAllEvents(repo) {
  const root = repo.root;
  const buckets = new Map(); // bucket -> Set(lines)
  const add = (bucket, line) => {
    if (!line.trim()) return;
    if (!buckets.has(bucket)) buckets.set(bucket, new Set());
    buckets.get(bucket).add(line);
  };
  const devsDir = path.join(tokentabyDir(root), 'devs');
  for (const dev of safeReaddir(devsDir)) {
    for (const f of safeReaddir(path.join(devsDir, dev))) {
      if (!f.endsWith('.ndjson')) continue;
      const rel = `.tokentaby/devs/${dev}/${f}`;
      for (const line of readText(path.join(root, rel)).split('\n')) add(rel, line);
    }
  }
  const rollDir = path.join(tokentabyDir(root), 'rollups');
  for (const f of safeReaddir(rollDir)) {
    if (f.endsWith('.ndjson')) for (const line of readText(path.join(rollDir, f)).split('\n')) add('rollups/' + f, line);
  }
  const dir = localDir(repo);
  for (const name of safeReaddir(dir)) {
    if (!name.startsWith('spool.ndjson')) continue;
    for (const line of readText(path.join(dir, name)).split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        add(monthPath(sanitizeDev(ev.dev), ev.ts), line);
      } catch {
        // skip corrupt spool line
      }
    }
  }
  const events = [];
  for (const lines of buckets.values()) {
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev && EVENT_TYPES.includes(ev.t)) events.push(ev);
      } catch {
        // validate reports corrupt lines; readers skip them
      }
    }
  }
  return events;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- watermarks & session state

const sessionDir = (session) => path.join(dataDir(), 'watermarks', sanitizeDev(session));
const watermarkFile = (session, key) => path.join(sessionDir(session), `${key}.json`);

function readWatermark(session, key) {
  return readJson(watermarkFile(session, key), null);
}

function writeWatermark(session, key, wm) {
  writeJsonAtomic(watermarkFile(session, key), wm);
}

function lockWatermark(session, key, fn) {
  return withLock(path.join(sessionDir(session), `${key}.lock`), fn);
}

function readSession(session) {
  return readJson(path.join(sessionDir(session), 'session.json'), {});
}

function writeSession(session, patch) {
  const next = { ...readSession(session), ...patch };
  writeJsonAtomic(path.join(sessionDir(session), 'session.json'), next);
  return next;
}

/** Remove watermark dirs untouched for `days` days. */
function pruneWatermarks(days = 45) {
  const root = path.join(dataDir(), 'watermarks');
  const cutoff = Date.now() - days * 86400000;
  for (const name of safeReaddir(root)) {
    const dir = path.join(root, name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // concurrent prune
    }
  }
}

module.exports = {
  SCHEMA_VERSION,
  EVENT_TYPES,
  dataDir,
  setDataDir,
  readJson,
  writeJsonAtomic,
  withLock,
  tokentabyDir,
  isInitialized,
  localDir,
  spoolFile,
  monthPath,
  sanitizeDev,
  devIdFor,
  readState,
  writeState,
  appendEvents,
  flushSpool,
  readAllEvents,
  readWatermark,
  writeWatermark,
  lockWatermark,
  readSession,
  writeSession,
  pruneWatermarks,
};
