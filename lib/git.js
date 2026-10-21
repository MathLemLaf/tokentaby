'use strict';
// Repository discovery and the few git operations tokentaby performs.
// Discovery reads .git directly instead of spawning git: hooks must stay fast.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Enclosing repository of `start`: { root, gitDir, commonDir }, or null.
 * Handles worktrees and submodules (.git file with a gitdir: pointer);
 * commonDir is shared by all worktrees of a clone.
 */
function findRepo(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    const dotgit = path.join(dir, '.git');
    let st = null;
    try {
      st = fs.statSync(dotgit);
    } catch {
      // keep walking up
    }
    if (st && st.isDirectory()) return { root: dir, gitDir: dotgit, commonDir: dotgit };
    if (st && st.isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotgit, 'utf8'));
      if (m) {
        const gitDir = path.resolve(dir, m[1]);
        let commonDir = gitDir;
        try {
          commonDir = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
        } catch {
          // not a worktree: the gitdir is the common dir
        }
        return { root: dir, gitDir, commonDir };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Checked-out branch name, or null on a detached HEAD. */
function currentBranch(repo) {
  try {
    const head = fs.readFileSync(path.join(repo.gitDir, 'HEAD'), 'utf8').trim();
    const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Name of a rebase/merge/cherry-pick/revert/bisect in progress, or null. */
function operationInProgress(repo) {
  const markers = {
    'rebase-merge': 'rebase',
    'rebase-apply': 'rebase',
    MERGE_HEAD: 'merge',
    CHERRY_PICK_HEAD: 'cherry-pick',
    REVERT_HEAD: 'revert',
    BISECT_LOG: 'bisect',
  };
  for (const [file, name] of Object.entries(markers)) {
    if (fs.existsSync(path.join(repo.gitDir, file))) return name;
  }
  return null;
}

function git(args, cwd, input) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout || '',
    stderr: (r.stderr || '') + (r.error ? String(r.error.message) : ''),
  };
}

/** `git config user.email` for the repo (honours includes), or ''. */
function userEmail(root) {
  const r = git(['config', 'user.email'], root);
  return r.ok ? r.stdout.trim() : '';
}

/** core.hooksPath from the repo's own config file, if set (no spawn). */
function configuredHooksPath(repo) {
  try {
    const cfg = fs.readFileSync(path.join(repo.commonDir, 'config'), 'utf8');
    const m = /^\s*hookspath\s*=\s*(.+?)\s*$/im.exec(cfg);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const BEGIN = '# >>> tokentaby >>>';
const END = '# <<< tokentaby <<<';

// Resolves the plugin through a pointer file refreshed on every SessionStart,
// so plugin updates (new versioned install dir) never break the hook.
const HOOK_BLOCK = [
  BEGIN,
  '# Ships your Claude Code usage (.tokentaby/devs/<you>/) with your commits',
  '# and refuses commits whose logged prompts contain obvious secrets.',
  'tt_root="$(cat "$(git rev-parse --git-common-dir)/tokentaby/plugin-root" 2>/dev/null)"',
  'if [ -n "$tt_root" ] && [ -f "$tt_root/bin/tokentaby" ] && command -v node >/dev/null 2>&1; then',
  '  node "$tt_root/bin/tokentaby" precommit || exit $?',
  'fi',
  END,
].join('\n');

/**
 * Install (or refresh) the tokentaby block in the pre-commit hook.
 * The block goes right after the shebang so an existing `exit 0` at the end
 * of someone's hook cannot skip it. When core.hooksPath points into the
 * working tree (husky & co), the hook file is shared and tracked, so this
 * only proceeds with `allowTracked`.
 * Returns { file, action } with action created|inserted|updated|unchanged|skipped.
 */
function installPreCommit(repo, { allowTracked = false } = {}) {
  const custom = configuredHooksPath(repo);
  let dir;
  if (custom) {
    dir = path.resolve(repo.root, custom.replace(/^~(?=$|\/)/, require('os').homedir()));
    const insideGitDir = !path.relative(repo.commonDir, dir).startsWith('..');
    if (!insideGitDir && !allowTracked) return { file: path.join(dir, 'pre-commit'), action: 'skipped' };
  } else {
    dir = path.join(repo.commonDir, 'hooks');
  }
  const file = path.join(dir, 'pre-commit');
  let current = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    // no hook yet
  }
  let next;
  let action;
  if (current == null) {
    next = '#!/bin/sh\n' + HOOK_BLOCK + '\n';
    action = 'created';
  } else if (current.includes(BEGIN)) {
    const re = new RegExp(escapeRe(BEGIN) + '[\\s\\S]*?' + escapeRe(END));
    next = current.replace(re, HOOK_BLOCK);
    action = next === current ? 'unchanged' : 'updated';
  } else {
    const lines = current.split('\n');
    const at = lines[0].startsWith('#!') ? 1 : 0;
    lines.splice(at, 0, HOOK_BLOCK);
    next = lines.join('\n');
    action = 'inserted';
  }
  if (action !== 'unchanged') {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, next);
  }
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    // Windows: git runs hooks through its bundled sh regardless of mode bits
  }
  return { file, action };
}

function hasPreCommit(repo) {
  const custom = configuredHooksPath(repo);
  const dir = custom ? path.resolve(repo.root, custom) : path.join(repo.commonDir, 'hooks');
  try {
    return fs.readFileSync(path.join(dir, 'pre-commit'), 'utf8').includes(BEGIN);
  } catch {
    return false;
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  findRepo,
  currentBranch,
  operationInProgress,
  git,
  userEmail,
  configuredHooksPath,
  installPreCommit,
  hasPreCommit,
  HOOK_BLOCK,
};
