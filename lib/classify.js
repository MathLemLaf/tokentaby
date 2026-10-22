'use strict';
// Classement par dossier (mode hub) : chaque événement porte le dossier du
// projet (`proj`, ex. "~/dev/genealogie") et les règles de
// .tokentaby/spheres.json le rangent dans une sphère, une application et un
// type d'usage. Le classement se fait à la lecture : modifier une règle
// reclasse tout l'historique, sans réécrire les données.
//
// Format des règles (la première qui correspond gagne) :
//   { "match": "~/dev/agile-lafond/*", "sphere": "Dev", "app": "{1}", "kind": "développement" }
//   { "match": "~/Documents/perso/**", "ignore": true }
// Motifs : `*` = un segment de dossier (capturé, réutilisable avec {1}, {2}…),
// `**` = n'importe quelle profondeur. Un motif couvre aussi les sous-dossiers.
// Gabarits : {1}…{9} (segments capturés), {name} (dernier segment), {proj}.

const os = require('os');
const path = require('path');

const NONE = { sphere: '(sans dossier)', app: '(inconnue)', kind: '(non défini)' };
const DEFAULT = { sphere: 'Non classé', app: '{name}', kind: 'autre' };

/** Chemin d'affichage stable : "~/..." sous le dossier personnel, barres obliques partout. */
function displayPath(dir, home = os.homedir()) {
  if (!dir) return null;
  const abs = path.resolve(dir).split(path.sep).join('/');
  const h = path.resolve(home).split(path.sep).join('/');
  if (abs === h) return '~';
  if (abs.toLowerCase().startsWith(h.toLowerCase() + '/')) return '~' + abs.slice(h.length);
  return abs;
}

function patternToRegex(pattern) {
  let p = String(pattern || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const home = os.homedir ? os.homedir() : '';
  if (home && p.startsWith(home.split(path.sep).join('/'))) p = displayPath(p);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      re += '.*';
      i++;
    } else if (c === '*') re += '([^/]*)';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}(?:/.*)?$`, 'i');
}

function fill(template, groups, proj) {
  if (template == null) return null;
  const name = proj ? proj.split('/').filter(Boolean).pop() || proj : '';
  return String(template)
    .replace(/\{(\d)\}/g, (_, n) => groups[Number(n) - 1] || '')
    .replace(/\{name\}/g, name)
    .replace(/\{proj\}/g, proj || '')
    .trim();
}

/**
 * Compile une configuration { rules, default } en fonction
 * proj -> { sphere, app, kind, ignore, rule }. Résultats mis en cache.
 */
function compile(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  const rules = (Array.isArray(cfg.rules) ? cfg.rules : []).filter((r) => r && r.match).map((r) => ({ ...r, re: patternToRegex(r.match) }));
  const def = { ...DEFAULT, ...(cfg.default || {}) };
  const cache = new Map();
  return function classify(proj) {
    if (!proj) return NONE;
    if (cache.has(proj)) return cache.get(proj);
    let out = null;
    for (const r of rules) {
      const m = r.re.exec(proj);
      if (!m) continue;
      const g = m.slice(1);
      out = r.ignore
        ? { ignore: true, rule: r.match }
        : {
            sphere: fill(r.sphere != null ? r.sphere : def.sphere, g, proj) || def.sphere,
            app: fill(r.app != null ? r.app : def.app, g, proj) || fill(def.app, [], proj),
            kind: fill(r.kind != null ? r.kind : def.kind, g, proj) || def.kind,
            rule: r.match,
          };
      break;
    }
    if (!out) out = { sphere: fill(def.sphere, [], proj), app: fill(def.app, [], proj), kind: fill(def.kind, [], proj), rule: null };
    cache.set(proj, out);
    return out;
  };
}

module.exports = { compile, displayPath, patternToRegex, NONE, DEFAULT };
