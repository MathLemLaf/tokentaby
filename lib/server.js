'use strict';
// Local dashboard server: serves dashboard/index.html and the JSON API over
// the team's committed usage plus this clone's queued events. Binds to
// loopback only; every request must carry a loopback Host header (DNS
// rebinding), and the write endpoints (pricing table, dev names) also refuse
// cross-origin requests.

const fs = require('fs');
const http = require('http');
const path = require('path');
const store = require('./store');
const api = require('./api');
const { Dataset } = require('./aggregate');
const { loadPricing } = require('./pricing');
const { resolveConfig } = require('./config');
const { compile } = require('./classify');

const loadRules = (root) => store.readJson(path.join(store.tokentabyDir(root), 'spheres.json'), {});

const DASHBOARD = path.join(__dirname, '..', 'dashboard', 'index.html');
const VERSION = store.readJson(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), {}).version || null;

/** Dataset for a repo, with the viewer's identity, dev names, pricing and config. */
function openDataset(repo) {
  const state = store.readState(repo);
  const cfg = resolveConfig(repo.root, state.options);
  const me = store.devIdFor(cfg, state);
  const names = store.readJson(path.join(store.tokentabyDir(repo.root), 'devs.json'), {});
  const pricing = loadPricing(repo.root);
  const events = store.readAllEvents(repo);
  const rules = loadRules(repo.root);
  const ds = new Dataset(events, { me, pricing, names, classify: compile(rules) });
  ds.cfg = cfg;
  return { ds, events, cfg, pricing, state, rules };
}

/** /api/meta for a repo. */
function metaFor(repo, opened, extra = {}) {
  return api.meta(opened.ds, opened.pricing, {
    repo: path.basename(repo.root),
    version: VERSION,
    pricingFile: store.readJson(path.join(store.tokentabyDir(repo.root), 'pricing.json'), null),
    ...extra,
  });
}

/** Signature of everything the dataset depends on, so it is rebuilt only when data changes. */
function dataSignature(repo) {
  const parts = [];
  const stat = (f) => {
    try {
      const s = fs.statSync(f);
      parts.push(`${f}:${s.size}:${s.mtimeMs}`);
    } catch {
      // missing is part of the signature too
    }
  };
  const base = store.tokentabyDir(repo.root);
  for (const f of ['pricing.json', 'devs.json', 'config.json', 'spheres.json']) stat(path.join(base, f));
  const walk = (dir) => {
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.ndjson')) stat(p);
    }
  };
  walk(path.join(base, 'devs'));
  walk(path.join(base, 'rollups'));
  try {
    for (const n of fs.readdirSync(store.localDir(repo))) if (n.startsWith('spool.ndjson')) stat(path.join(store.localDir(repo), n));
  } catch {
    // no local spool yet
  }
  return parts.join('|');
}

function createServer({ repo, port }) {
  let cache = { sig: null, opened: null };
  const load = () => {
    const sig = dataSignature(repo);
    if (cache.sig !== sig) cache = { sig, opened: openDataset(repo) };
    return cache.opened;
  };
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body, type = 'application/json; charset=utf-8', extra = {}) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (!allowedHosts.has(req.headers.host || '')) return send(421, { error: 'unexpected Host header' });
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(200, fs.readFileSync(DASHBOARD), 'text/html; charset=utf-8');
      }
      const opened = load();
      const f = api.filtersFrom(url.searchParams);
      if (req.method === 'GET') {
        if (url.pathname === '/api/meta') return send(200, metaFor(repo, opened));
        const body = api.view(opened.ds, url.pathname, f);
        if (body !== undefined) return send(200, body);
        if (url.pathname === '/api/events') {
          const type = url.searchParams.get('type');
          const events = opened.events.filter((e) => (!type || e.t === type) && (!f.dev || e.dev === f.dev));
          const limit = f.limit != null ? f.limit : 5000;
          return send(200, { total: events.length, events: limit ? events.slice(-limit) : events });
        }
        const exp = /^\/api\/export\.(csv|json)$/.exec(url.pathname);
        if (exp) {
          const kind = url.searchParams.get('kind') || 'turns';
          if (!api.EXPORT_COLUMNS[kind]) return send(400, { error: `unknown export kind "${kind}"` });
          const file = api.exportFile(opened.ds, opened.events, kind, exp[1], f);
          return send(200, file.body, file.type, { 'Content-Disposition': `attachment; filename="${file.filename}"` });
        }
      }
      if (req.method === 'PUT' && (url.pathname === '/api/pricing' || url.pathname === '/api/devs-map')) {
        const origin = req.headers.origin;
        if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) return send(403, { error: 'cross-origin write refused' });
        const body = JSON.parse(await readBody(req));
        const file = url.pathname === '/api/pricing' ? 'pricing.json' : 'devs.json';
        const problem = file === 'pricing.json' ? pricingProblem(body) : devsProblem(body);
        if (problem) return send(400, { error: problem });
        fs.writeFileSync(path.join(store.tokentabyDir(repo.root), file), JSON.stringify(body, null, 2) + '\n');
        return send(200, { ok: true, file: `.tokentaby/${file}`, note: 'Commit this file to share it with the team.' });
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      return send(500, { error: String((e && e.message) || e) });
    }
  }

  return http.createServer((req, res) => {
    handle(req, res);
  });
}

function readBody(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new Error('request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function pricingProblem(p) {
  if (!p || typeof p !== 'object' || !p.models || typeof p.models !== 'object') return 'pricing must be an object with a "models" map';
  for (const [id, m] of Object.entries(p.models)) {
    if (!m || typeof m.input !== 'number' || typeof m.output !== 'number' || m.input < 0 || m.output < 0) return `model "${id}" needs non-negative numeric "input" and "output" prices`;
  }
  return null;
}

function devsProblem(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'devs map must be an object keyed by dev id';
  for (const [id, v] of Object.entries(d)) {
    if (store.sanitizeDev(id) !== id) return `"${id}" is not a valid dev id`;
    if (v && typeof v !== 'object' && typeof v !== 'string') return `entry for "${id}" must be an object or a name`;
  }
  return null;
}

module.exports = { createServer, openDataset, metaFor, dataSignature };
