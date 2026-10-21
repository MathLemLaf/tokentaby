'use strict';
// Obvious credential patterns. Conservative on purpose: a false positive only
// puts a [REDACTED] marker in a logged prompt, a false negative commits a key.

const PATTERNS = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'stripe-key', re: /\b(?:sk|rk|whsec)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'slack-token', re: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // user:pass@host in URLs — keep the scheme and user, drop the password
  { name: 'url-credentials', re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)(?!\[REDACTED\])([^\s@/]{3,})(@)/gi, keep: '$1[REDACTED]$3' },
  // password = "hunter22", API_KEY: abc… — keep the key name, drop the value
  {
    name: 'credential-assignment',
    re: /\b((?:[A-Za-z0-9_]*_)?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*)(["']?)(?!\[REDACTED\])([^\s"']{8,})\2/gi,
    keep: '$1$2[REDACTED]$2',
  },
];

/** Replace every match with a marker. Returns the cleaned text and the pattern names that hit. */
function redact(text) {
  let out = String(text == null ? '' : text);
  const hits = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    if (!p.re.test(out)) continue;
    hits.push(p.name);
    p.re.lastIndex = 0;
    out = out.replace(p.re, p.keep || '[REDACTED]');
  }
  return { text: out, hits };
}

/** Pattern names found in text, without modifying it. */
function scan(text) {
  return redact(text).hits;
}

module.exports = { redact, scan, PATTERNS };
