#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VERSION_FILE = path.join(__dirname, '..', 'public', 'version.json');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }).trim();
}

function safeRun(cmd) {
  try {
    return run(cmd);
  } catch (err) {
    return '';
  }
}

function parseVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag || '');
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function readCurrentVersionFile() {
  try {
    const raw = fs.readFileSync(VERSION_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.version !== 'string') return null;
    return parsed.version.trim();
  } catch (err) {
    return null;
  }
}

function bumpVersion([major, minor, patch], bump) {
  if (bump === 'major') return [major + 1, 0, 0];
  if (bump === 'minor') return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

function computeBump(commits) {
  let bump = null;
  for (const msg of commits) {
    if (/BREAKING CHANGE/i.test(msg) || /^.+!:/i.test(msg)) {
      return 'major';
    }
    if (/^feat(\(.+\))?!?:/i.test(msg)) {
      bump = bump === 'major' ? 'major' : 'minor';
    } else if (/^fix(\(.+\))?!?:/i.test(msg)) {
      bump = bump || 'patch';
    }
  }
  return bump || 'patch';
}

function ensureCleanTree() {
  const status = safeRun('git status --porcelain');
  const dirtyLines = status
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.endsWith('public/version.json'));

  if (dirtyLines.length > 0) {
    console.error('Working tree must be clean before releasing. Commit or stash your changes first.');
    process.exit(1);
  }
}

function main() {
  ensureCleanTree();

  const lastTag = safeRun('git describe --tags --abbrev=0');
  const fallbackVersion = readCurrentVersionFile();
  const baseVersion = parseVersion(lastTag || fallbackVersion || 'v0.0.0');
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const commitLog = safeRun(`git log ${range} --pretty=%s --no-merges`);
  const commits = commitLog
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (commits.length === 0) {
    console.log('No commits since last tag; skipping release.');
    process.exit(0);
  }

  const bump = computeBump(commits);
  const [major, minor, patch] = bumpVersion(baseVersion, bump);
  const nextVersion = `${major}.${minor}.${patch}`;
  const tagName = `v${nextVersion}`;

  if (safeRun(`git tag --list ${tagName}`)) {
    console.log(`Tag ${tagName} already exists. Nothing to do.`);
    process.exit(0);
  }

  const versionPayload = { version: nextVersion };
  fs.writeFileSync(VERSION_FILE, `${JSON.stringify(versionPayload, null, 2)}\n`);
  run(`git add ${VERSION_FILE}`);

  const stagedStatus = safeRun('git diff --cached --name-only');
  if (!stagedStatus.includes('public/version.json')) {
    console.log('Version file did not change; skipping commit and tag.');
    process.exit(0);
  }

  run(`git commit -m "chore: release v${nextVersion}"`);
  // Use an annotated tag so CI's `git push --follow-tags` pushes it.
  run(`git tag -a ${tagName} -m "Release ${tagName}"`);

  console.log(`Released ${tagName}`);
}

main();
