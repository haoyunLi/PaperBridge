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

async function probeVersion(executable, toolsRoot) {
  const options = { timeout: 15000, windowsHide: true };
  try {
    const { stdout } = await exec(executable, ['version', '--json'], { ...options, env: mineru4Environment(toolsRoot, 'auto') });
    const version = JSON.parse(stdout).mineru_version;
    if (typeof version === 'string') return `MinerU ${version}`;
  } catch { /* Legacy MinerU uses --version. */ }
  const result = await exec(executable, ['--version'], options);
  return String(result.stdout || result.stderr || '').trim().slice(0, 200);
}

function mineru4Environment(toolsRoot, backend) {
  const home = path.join(toolsRoot, 'mineru4-data');
  const env = {
    ...process.env,
    MINERU_HOME: home,
    MINERU_TELEMETRY_DISABLED: '1',
    MINERU_MODEL_SMALL_BACKEND: 'onnx',
    MINERU_MODEL_ONNX_DEVICE: backend === 'pipeline' ? 'cpu' : 'auto',
    PYTHONUTF8: '1'
  };
  // An explicit config path must already exist. Use the default in the private home.
  delete env.MINERU_CONFIG;
  delete env.MINERU_MODEL_STACK;
  return env;
}

function mineruInvocation(detected, pdf, output, backend, toolsRoot) {
  if (detected.kitExecutable) {
    const markdown = path.join(output, 'paper.md');
    return {
      command: detected.kitExecutable, markdown,
      args: ['parse', pdf, '-o', markdown, '--pages', 'all', '--tier', 'basic', '--ocr-mode', 'auto'],
      env: mineru4Environment(toolsRoot, backend)
    };
  }
  const args = ['-p', pdf, '-o', output];
  if (backend === 'pipeline') args.push('-b', 'pipeline');
  return { command: detected.executable, args, env: process.env };
}

async function detectMineruExecutable(configured, toolsRoot, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const checkVersion = options.probeVersion || probeVersion;
  function isFile(file) {
    try { return fileSystem.statSync(file).isFile(); } catch { return false; }
  }
  let firstIncompatible = null;
  for (const candidate of candidates(configured, toolsRoot, options.environment)) {
    if (!isFile(candidate.executable)) continue;
    let version;
    try { version = String(await checkVersion(candidate.executable, toolsRoot)).trim().slice(0, 200); }
    catch { version = 'The command did not start'; }
    const legacy = /(?:^|[\s,])3\.\d+(?:\.\d+)?$/.test(version);
    const modern = /(?:^|[\s,])4\.(?:[1-9]\d*)\.\d+(?:\.post\d+)?$/.test(version);
    const kit = path.join(path.dirname(candidate.executable), 'mineru-kit.exe');
    const kitExecutable = modern && isFile(kit) ? kit : '';
    const compatible = legacy || Boolean(kitExecutable);
    const reason = modern ? `MinerU at ${candidate.executable} is missing mineru-kit.exe beside it.`
      : `MinerU at ${candidate.executable} does not report a compatible 3.x or 4.1+ version.`;
    const found = { installed: true, compatible, executable: candidate.executable,
      version, source: candidate.source, kitExecutable, reason: compatible ? '' : reason };
    if (compatible) return found;
    firstIncompatible ||= found;
  }
  if (firstIncompatible) return firstIncompatible;
  const explicit = String(configured || '').trim();
  return { installed: false, compatible: false, executable: '', version: '', source: '',
    reason: explicit && !/^(?:mineru|mineru\.exe)$/i.test(explicit) ? `Configured MinerU executable was not found: ${explicit}`
      : 'MinerU was not found in PaperBridge managed tools or on PATH. Install it in Local AI setup or enter its full path.' };
}

module.exports = { candidates, detectMineruExecutable, mineru4Environment, mineruInvocation };
