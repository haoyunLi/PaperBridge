const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const exec = promisify(execFile);

function candidates(configured, toolsRoot, environment = process.env) {
  const selected = String(configured || '').trim();
  if (selected && !/^(?:mineru|mineru\.exe)$/i.test(selected)) return [{ executable: path.resolve(selected), source: 'configured' }];
  const result = [];
  if (toolsRoot) result.push({ executable: path.join(toolsRoot, 'mineru', 'Scripts', 'mineru.exe'), source: 'managed' });
  for (const directory of String(environment.PATH || environment.Path || '').split(path.delimiter)) {
    const cleaned = directory.trim().replace(/^"|"$/g, '');
    if (cleaned) result.push({ executable: path.join(cleaned, 'mineru.exe'), source: 'path' });
  }
  const seen = new Set();
  return result.filter(candidate => {
    const key = path.resolve(candidate.executable).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function probeVersion(executable) {
  const result = await exec(executable, ['--version'], { timeout: 15000, windowsHide: true });
  return String(result.stdout || result.stderr || '').trim().slice(0, 200);
}

async function detectMineruExecutable(configured, toolsRoot, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const checkVersion = options.probeVersion || probeVersion;
  let firstIncompatible = null;
  for (const candidate of candidates(configured, toolsRoot, options.environment)) {
    let isFile = false;
    try { isFile = fileSystem.statSync(candidate.executable).isFile(); } catch { /* Candidate is absent. */ }
    if (!isFile) continue;
    let version;
    try { version = String(await checkVersion(candidate.executable)).trim().slice(0, 200); }
    catch { version = 'The command did not start'; }
    const compatible = /(?:^|\D)3\.\d+(?:\.\d+)?(?=\D|$)/.test(version);
    const found = { installed: true, compatible, executable: candidate.executable,
      version, source: candidate.source, reason: compatible ? '' : `MinerU at ${candidate.executable} does not report a compatible 3.x version.` };
    if (compatible) return found;
    firstIncompatible ||= found;
  }
  if (firstIncompatible) return firstIncompatible;
  const explicit = String(configured || '').trim();
  return { installed: false, compatible: false, executable: '', version: '', source: '',
    reason: explicit && !/^(?:mineru|mineru\.exe)$/i.test(explicit) ? `Configured MinerU executable was not found: ${explicit}`
      : 'MinerU was not found in PaperBridge managed tools or on PATH. Install it in Local AI setup or enter its full path.' };
}

module.exports = { candidates, detectMineruExecutable };
