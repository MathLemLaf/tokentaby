'use strict';
// Fake credentials for the redaction tests, assembled from fragments at
// runtime so no key-shaped literal ships in the repository — secret scanners
// (the plugin directory's included) would rightly flag one.

const j = (...parts) => parts.join('');

module.exports = {
  aws: j('AKIA', 'ABCDEFGHIJKLMNOP'),
  github: j('gh', 'p_', 'abcdefghijklmnopqrstuvwxyz', '0123456789AB'),
  anthropic: j('sk-', 'ant-', 'api03-', 'abcdefghijklmnopqrstuvwxyz'),
  slack: j('xo', 'xb-', '1234567890-abcdefghij'),
  jwt: [j('ey', 'JhbGciOiJIUzI1NiJ9'), j('ey', 'JzdWIiOiJ0ZXN0In0'), j('c2lnbmF0dXJl', 'LXRlc3Q')].join('.'),
  pgUrl: j('postgres://admin', ':', 'hunter22', '@db.internal:5432/app'),
  pgUrlRedacted: j('postgres://admin', ':', '[REDACTED]', '@db.internal:5432/app'),
  passwordAssignment: j('DB_PASS', 'WORD="', 'correct-horse-battery', '"'),
  passwordAssignmentRedacted: j('DB_PASS', 'WORD="', '[REDACTED]', '"'),
  pem: [j('-----BEGIN RSA ', 'PRIVATE KEY-----'), 'MIIEow', j('-----END RSA ', 'PRIVATE KEY-----')].join('\n'),
};
