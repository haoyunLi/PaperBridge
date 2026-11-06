const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function mineruPaths(toolsRoot) {
  const root = path.resolve(toolsRoot);
  return {
    root,
    final: path.join(root, 'mineru'),
    staging: path.join(root, 'mineru.installing'),
    rollback: path.join(root, 'mineru.rollback'),
    retired: path.join(root, 'mineru.retired'),
    legacyBackup: path.join(root, 'mineru.backup')
  };
}

function setupOwners(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).flatMap(name => {
    const owner = /^\.mineru-setup-(\d{1,10})-[a-f0-9-]+$/.exec(name);
    const pid = Number(owner?.[1]);
    if (!owner || pid < 1 || pid > 0x7fffffff) return [];
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return []; }
    return [name];
  });
}

function claimMineruSetup(root) {
  if (setupOwners(root).length) return null;
  fs.mkdirSync(root, { recursive: true });
  const name = `.mineru-setup-${process.pid}-${randomUUID()}`;
  const marker = path.join(root, name);
  fs.writeFileSync(marker, '', { flag: 'wx' });
  const release = () => fs.rmSync(marker, { force: true });
  try {
    // Each contender has its own marker. A simultaneous claim may fail on both
    // sides, but two writers cannot both pass this check.
    if (!setupOwners(root).some(owner => owner !== name)) return release;
  } catch (error) { release(); throw error; }
  release();
  return null;
}

const removeEnvironment = directory => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });

function rollbackMineru({ final, rollback }) {
  if (!fs.existsSync(rollback)) return;
  removeEnvironment(final);
  if (fs.readdirSync(rollback).length) fs.renameSync(rollback, final);
  else fs.rmdirSync(rollback);
}

function recoverMineru(paths) {
  rollbackMineru(paths);
  if (!fs.existsSync(paths.final) && fs.existsSync(paths.legacyBackup)) fs.renameSync(paths.legacyBackup, paths.final);
}

function managedMineruAvailable(toolsRoot) {
  const paths = mineruPaths(toolsRoot);
  if (setupOwners(paths.root).length) return false;
  if (!fs.existsSync(paths.rollback) && (!fs.existsSync(paths.legacyBackup) || fs.existsSync(paths.final))) return true;
  const release = claimMineruSetup(paths.root);
  if (!release) return false;
  try { recoverMineru(paths); }
  finally { release(); }
  return true;
}

function beginMineruActivation({ final, rollback }) {
  if (fs.existsSync(final)) fs.renameSync(final, rollback);
  else fs.mkdirSync(rollback);
}

function commitMineruActivation({ rollback, retired }) {
  removeEnvironment(retired);
  // Moving the entire rollback directory is the commit point. A crash while
  // deleting the retired files cannot make them look like a usable backup.
  fs.renameSync(rollback, retired);
}

module.exports = { mineruPaths, claimMineruSetup, managedMineruAvailable, recoverMineru, rollbackMineru,
  beginMineruActivation, commitMineruActivation, removeEnvironment };
