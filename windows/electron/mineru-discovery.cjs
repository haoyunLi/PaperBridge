const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { isMineruReady } = require('./mineru-readiness.mjs');
const { mineruPaths, managedMineruAvailable } = require('./mineru-installation.cjs');

const exec = promisify(execFile);

const pythonVersionDir = /^Python3\d{1,2}t?(?:-(?:32|64|arm64))?$/i;

function userPythonBase(environment) {
  return environment.PYTHONUSERBASE || (environment.APPDATA && path.join(environment.APPDATA, 'Python'));
}

function pythonScriptDirectories(root, fileSystem) {
  if (!root || !path.isAbsolute(root)) return [];
  try {
    return fileSystem.readdirSync(root, { withFileTypes: true })
      .filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && pythonVersionDir.test(entry.name))
      .map(entry => entry.name).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
      .map(name => path.join(root, name, 'Scripts'));
  } catch { return []; }
}

function candidates(configured, toolsRoot, environment = process.env, fileSystem = fs) {
  const selected = String(configured || '').trim();
  if (selected && !/^(?:mineru|mineru\.exe)$/i.test(selected)) return [{ executable: path.resolve(selected), source: 'configured' }];
  const result = [];
  if (toolsRoot) result.push({ executable: path.join(toolsRoot, 'mineru', 'Scripts', 'mineru.exe'), source: 'managed' });
  for (const directory of String(environment.PATH || environment.Path || '').split(path.delimiter)) {
    const cleaned = directory.trim().replace(/^"|"$/g, '');
    if (cleaned) result.push({ executable: path.join(cleaned, 'mineru.exe'), source: 'path' });
  }
  const localPython = environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs', 'Python');
  for (const root of [userPythonBase(environment), localPython]) {
    for (const directory of pythonScriptDirectories(root, fileSystem)) {
      result.push({ executable: path.join(directory, 'mineru.exe'), source: 'python' });
    }
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
    // MinerU creates long model-derived filenames under this directory on Windows.
    MINERU_HOME: path.toNamespacedPath(home),
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

function createMineruStaging(detected, temporary, localAppData) {
  const prefix = 'paperbridge-mineru-';
  let root = path.resolve(temporary);
  if (process.platform === 'win32' && detected.kitExecutable) {
    // MinerU's ZIP writer joins "images/name.jpg" to its output directory.
    // Windows only accepts those embedded forward slashes in ordinary DOS/UNC paths.
    const ordinary = value => value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\(?=[a-z]:\\)/i, '');
    root = ordinary(root);
    // Leave room under MAX_PATH for MinerU's nested temporary files on machines
    // with long paths disabled. Prefer the user's configured TEMP when it fits.
    const nestedImage = path.join(prefix + 'XXXXXX', 'output', '.mineru-kit-XXXXXXXX', 'images', 'page_123456_chart_123456.jpg');
    if (path.join(root, nestedImage).length >= 260 && localAppData && path.isAbsolute(localAppData)) {
      const fallback = path.join(ordinary(localAppData), 'Temp');
      if (fallback.length < root.length) {
        try {
          fs.mkdirSync(fallback, { recursive: true });
          return { root: fallback, directory: fs.mkdtempSync(path.join(fallback, prefix)) };
        } catch { /* The configured TEMP can still work when long paths are enabled. */ }
      }
    }
  }
  return { root, directory: fs.mkdtempSync(path.join(root, prefix)) };
}

function mineruInvocation(detected, pdf, output, backend, toolsRoot, cpuFallback = false) {
  if (detected.kitExecutable) {
    const archive = path.join(output, 'paper.zip');
    return {
      command: detected.kitExecutable,
      args: ['parse', path.toNamespacedPath(pdf), '-o', archive, '--format', 'zip', '--pages', 'all', '--tier', 'basic', '--ocr-mode', 'auto'],
      env: mineru4Environment(toolsRoot, backend)
    };
  }
  const args = ['-p', pdf, '-o', output];
  if (backend === 'pipeline' || cpuFallback) args.push('-b', 'pipeline');
  // The legacy pipeline independently auto-selects CUDA unless its process is told to use CPU.
  const env = cpuFallback ? { ...process.env, MINERU_DEVICE_MODE: 'cpu' } : process.env;
  return { command: detected.executable, args, env };
}

function isFile(file, fileSystem = fs) {
  try { return fileSystem.statSync(file).isFile(); } catch { return false; }
}

function mineruPython(executable, environment = process.env) {
  const directory = path.dirname(executable);
  const adjacent = path.join(directory, 'python.exe');
  if (isFile(adjacent)) return adjacent;
  if (path.basename(directory).toLowerCase() !== 'scripts') return '';
  // A system-wide pip install writes its launcher under Scripts and uses the
  // interpreter in the parent prefix. Confirm that prefix owns the package.
  const prefix = path.dirname(directory);
  const python = path.join(prefix, 'python.exe');
  if (isFile(python) && isFile(path.join(prefix, 'Lib', 'site-packages', 'mineru', '__init__.py'))) return python;

  // pip --user keeps the entry point and package under the user base. Its
  // distlib launcher records the interpreter immediately before the ZIP entry.
  const base = userPythonBase(environment);
  if (!base || !environment.LOCALAPPDATA || !pythonVersionDir.test(path.basename(prefix)) ||
      path.resolve(path.dirname(prefix)).toLowerCase() !== path.resolve(base).toLowerCase() ||
      !isFile(path.join(prefix, 'site-packages', 'mineru', '__init__.py'))) return '';
  try {
    if (fs.statSync(executable).size > 1024 * 1024) return '';
    const launcher = fs.readFileSync(executable);
    const header = /#!(?:"([^"\x00-\x1f]+)"|([^"\x00-\x1f]+))\r?\nPK\x03\x04/.exec(launcher.subarray(-65536).toString('utf8'));
    const recorded = header?.[1] || header?.[2];
    if (!recorded || !path.isAbsolute(recorded)) return '';
    const local = path.join(environment.LOCALAPPDATA, 'Programs', 'Python');
    const version = path.basename(prefix).replace(/-(?:32|64|arm64)$/i, '');
    for (const suffix of ['', '-32', '-64', '-arm64']) {
      const expected = path.join(local, version + suffix, 'python.exe');
      if (path.resolve(recorded).toLowerCase() === path.resolve(expected).toLowerCase() && isFile(expected)) return expected;
    }
  } catch { /* Unknown launchers retain their normal import path. */ }
  return '';
}

async function detectMineruExecutable(configured, toolsRoot, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const checkVersion = options.probeVersion || probeVersion;
  let firstUnchecked = null;
  let firstUnusable = null;
  let firstIncompatible = null;
  let managedUnavailable = '';
  const managed = toolsRoot && path.join(mineruPaths(toolsRoot).final, 'Scripts', 'mineru.exe').toLowerCase();
  for (const candidate of candidates(configured, toolsRoot, options.environment, fileSystem)) {
    if (managed && path.resolve(candidate.executable).toLowerCase() === managed && !options.repairOwner) {
      try {
        if (!managedMineruAvailable(toolsRoot)) managedUnavailable = 'MinerU setup is running in another operation. Wait for it to finish.';
      } catch (error) { managedUnavailable = `Could not recover the previous MinerU installation: ${error.message}`; }
      if (managedUnavailable) continue;
    }
    if (!isFile(candidate.executable, fileSystem)) continue;
    let version;
    try { version = String(await checkVersion(candidate.executable, toolsRoot)).trim().slice(0, 200); }
    catch { version = 'The command did not start'; }
    const legacy = /(?:^|[\s,])3\.\d+(?:\.\d+)?$/.test(version);
    const modern = /(?:^|[\s,])4\.(?:[1-9]\d*)\.\d+(?:\.post\d+)?$/.test(version);
    const kit = path.join(path.dirname(candidate.executable), 'mineru-kit.exe');
    const kitExecutable = modern && isFile(kit, fileSystem) ? kit : '';
    const compatible = legacy || Boolean(kitExecutable);
    const reason = modern ? `MinerU at ${candidate.executable} is missing mineru-kit.exe beside it.`
      : `MinerU at ${candidate.executable} does not report a compatible 3.x or 4.1+ version.`;
    const found = { installed: true, compatible, executable: candidate.executable,
      version, source: candidate.source, kitExecutable, reason: compatible ? '' : reason };
    if (!compatible) {
      firstIncompatible ||= found;
      continue;
    }
    if (!options.probeRuntime) return found;
    found.runtime = await options.probeRuntime(found);
    if (isMineruReady(found)) {
      if (found.runtime?.checked) return found;
      firstUnchecked ||= found;
    } else firstUnusable ||= found;
  }
  // A working fallback avoids reinstalling a broken earlier PATH entry. Keep
  // unknown legacy launchers usable if no verified alternative exists.
  const fallback = firstUnchecked || firstUnusable || firstIncompatible;
  if (fallback) return fallback;
  const explicit = String(configured || '').trim();
  return { installed: false, compatible: false, executable: '', version: '', source: '',
    reason: managedUnavailable || (explicit && !/^(?:mineru|mineru\.exe)$/i.test(explicit) ? `Configured MinerU executable was not found: ${explicit}`
      : 'MinerU was not found in PaperBridge managed tools, on PATH or in the standard per-user Python directories. Install it in Local AI setup or enter its full path.') };
}

module.exports = { candidates, createMineruStaging, detectMineruExecutable, mineru4Environment, mineruInvocation, mineruPython };
