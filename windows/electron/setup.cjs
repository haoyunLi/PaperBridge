const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { isMineruReady } = require('./mineru-readiness.mjs');
const { missingOllamaModels } = require('./ollama-models.mjs');
const { ollamaPath, ollamaLaunch, localServerEndpoint } = require('./ollama-installation.cjs');
const { graphicsStatus, mineruRuntime } = require('./hardware.cjs');
const { detectMineruExecutable, mineru4Environment } = require('./mineru-discovery.cjs');
const { mineruPaths, claimMineruSetup, recoverMineru, rollbackMineru, beginMineruActivation,
  commitMineruActivation, removeEnvironment } = require('./mineru-installation.cjs');

const exec = promisify(execFile);
const UV_VERSION = '0.11.29';
const UV_ARTIFACTS = {
  x64: { name: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'a047d55651bc3e0ca24595b25ec4cfcb10f9dca9fb56514e661269b37d4fae68' },
  arm64: { name: 'uv-aarch64-pc-windows-msvc.zip', sha256: '55b597ae81bc29531a7c352a1431a8a73cc2755d7a5b9ec454580cbe02e5154f' }
};
const MINERU_VERSION = '3.4.5'; // Legacy CLI for the managed NVIDIA PyTorch CUDA path.
const MINERU_ONNX_VERSION = '4.1.7';

function versionAtLeast(actual, minimum) {
  const a = String(actual || '').split('.').map(Number);
  const b = minimum.split('.').map(Number);
  return a[0] > b[0] || (a[0] === b[0] && (a[1] || 0) >= (b[1] || 0));
}

function onnxDevicePlan(backend) {
  return backend === 'pipeline'
    ? 'MinerU will use the CPU selected in parser settings. Ollama selects acceleration separately.'
    : 'MinerU checks for DirectML and uses CPU when GPU acceleration is unavailable. Ollama selects acceleration separately.';
}

function cudaPlan(hardware, backend) {
  if (!hardware?.cudaDriver?.length) return { index: null, reason: process.arch === 'x64'
    ? onnxDevicePlan(backend)
    : 'No NVIDIA CUDA driver was detected; the managed MinerU installation uses its CPU pipeline.' };
  if (versionAtLeast(hardware.cudaVersion, '12.8')) return { index: 'cu128', reason: `NVIDIA CUDA ${hardware.cudaVersion}: install matching PyTorch CUDA wheels in the managed MinerU environment.` };
  if (versionAtLeast(hardware.cudaVersion, '12.6')) return { index: 'cu126', reason: `NVIDIA CUDA ${hardware.cudaVersion}: install matching PyTorch CUDA wheels in the managed MinerU environment.` };
  const fallback = process.arch === 'x64' ? onnxDevicePlan(backend) : 'The managed MinerU installation uses its CPU pipeline.';
  return { index: null, reason: `NVIDIA driver reports CUDA ${hardware.cudaVersion || 'unknown'}. Managed CUDA wheels require 12.6 or newer. ${fallback}` };
}

function selectedComponents(components) {
  if (components == null) return { ollama: true, models: true, mineru: true };
  if (typeof components !== 'object' || Array.isArray(components)) throw new Error('Choose valid setup components.');
  for (const key of ['ollama', 'models', 'mineru']) {
    if (Object.hasOwn(components, key) && typeof components[key] !== 'boolean') throw new Error('Choose valid setup components.');
  }
  return { ollama: components.ollama === true, models: components.models === true, mineru: components.mineru === true };
}

function setupPlan(status, requiredModels = [], config = {}) {
  const components = selectedComponents(config.components);
  const models = components.models ? missingOllamaModels(requiredModels, status.ollama.models) : [];
  const gpu = cudaPlan(status.hardware, config.mineruBackend);
  const parserReady = isMineruReady(status.mineru);
  const keepCpuPipeline = config.mineruBackend === 'pipeline' && parserReady &&
    !status.mineru.kitExecutable && status.mineru.runtime?.checked === true && status.mineru.runtime.cuda === false;
  if (status.mineru.kitExecutable) {
    const parser = parserReady && !config.repairMineru ? 'Setup keeps the installed MinerU ONNX parser.' :
      'Setup will repair the managed MinerU ONNX environment.';
    gpu.reason = parser + ' ' + onnxDevicePlan(config.mineruBackend);
  } else if (gpu.index && keepCpuPipeline && !config.repairMineru) {
    gpu.reason = 'MinerU is ready with its CPU pipeline. Choose Repair / update MinerU to retry CUDA.';
  }
  const ollamaRequiredByModels = components.models && !components.ollama && !status.ollama.running;
  return {
    ollama: !status.ollama.running && (components.ollama || components.models),
    models,
    mineru: components.mineru && (Boolean(config.repairMineru) || !parserReady
      || Boolean(gpu.index && !status.mineru.kitExecutable && !status.mineru.runtime?.cuda && !keepCpuPipeline)),
    gpu,
    components,
    ollamaRequiredByModels
  };
}

function cancelled(signal) {
  if (signal?.aborted) { const error = new Error('Setup cancelled. You can resume it later.'); error.name = 'AbortError'; throw error; }
}

async function activateStagedMineru(staging, final, signal) {
  for (let attempt = 0; ; attempt++) {
    cancelled(signal);
    try { fs.renameSync(staging, final); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 12) throw error;
    }
    // A Windows scanner or a recently closed launcher can still have a handle
    // on the staged environment after its verification process exits.
    await delay(250);
  }
}

async function mineruStatus(configured, toolsRoot, backend) {
  const found = await detectMineruExecutable(configured, toolsRoot, {
    probeRuntime: candidate => mineruRuntime(candidate.executable, toolsRoot, { found: candidate, backend })
  });
  return { ...found, runtime: found.runtime ?? null };
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function managedPythonPath(toolsRoot) {
  const directory = path.join(toolsRoot, 'python');
  if (!fs.existsSync(directory)) return '';
  const architecture = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const version = new RegExp(`^cpython-3\\.12\\.(\\d+)-windows-${architecture}-none$`);
  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter(item => item.isDirectory() && version.test(item.name))
    .sort((a, b) => Number(b.name.match(version)[1]) - Number(a.name.match(version)[1]));
  return candidates.map(item => path.join(directory, item.name, 'python.exe')).find(fs.existsSync) || '';
}

function ownedPath(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (path.dirname(resolved) !== resolvedRoot) throw new Error('Unexpected managed tool path.');
  return resolved;
}

class SetupManager {
  constructor({ toolsRoot, ollamaRequest, pullModel, emit }) {
    this.toolsRoot = toolsRoot;
    this.ollamaRequest = ollamaRequest;
    this.pullModel = pullModel;
    this.emit = emit;
    this.controller = null;
    this.child = null;
    this.lastProgress = null;
  }

  send(phase, message, extra = {}) {
    this.lastProgress = { kind: 'setup', phase, message, ...extra };
    this.emit(this.lastProgress);
  }

  async status({ baseURL, mineruExecutable, mineruBackend, models = [], components, repairMineru = false }) {
    const [hardware, mineru, appPath, response] = await Promise.all([
      graphicsStatus(), mineruStatus(mineruExecutable, this.toolsRoot, mineruBackend), ollamaPath(),
      this.ollamaRequest(baseURL, 'api/tags', { signal: AbortSignal.timeout(3500) }).then(async value => ({ running: true, models: (await value.json()).models?.map(item => item.model || item.name).filter(Boolean) || [] })).catch(error => ({ running: false, models: [], error: error.message }))
    ]);
    const result = { hardware, mineru, ollama: { installed: Boolean(appPath), path: appPath, ...response } };
    result.plan = setupPlan(result, models, { components, repairMineru, mineruBackend });
    result.progress = this.lastProgress;
    result.busy = Boolean(this.controller);
    return result;
  }

  cancel() {
    this.controller?.abort();
    this.child?.kill();
    return Boolean(this.controller);
  }

  async run(command, args, phase, message, options = {}) {
    const signal = this.controller.signal;
    cancelled(signal);
    this.send(phase, message);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, windowsHide: true, ...options });
      this.child = child;
      let tail = '';
      let lastUpdate = 0;
      const collect = data => {
        tail = (tail + data.toString()).slice(-6000);
        if (Date.now() - lastUpdate > 700) {
          const line = tail.trim().split(/\r?\n/).at(-1);
          if (line) this.send(phase, `${message} ${line.slice(0, 150)}`);
          lastUpdate = Date.now();
        }
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      child.once('error', error => { if (this.child === child) this.child = null; reject(error); });
      child.once('close', code => {
        if (this.child === child) this.child = null;
        if (signal.aborted) { const error = new Error('Setup cancelled. You can resume it later.'); error.name = 'AbortError'; reject(error); }
        else if (code === 0) resolve(tail.trim());
        else reject(new Error(`${path.basename(command)} exited ${code}: ${tail.trim().slice(-500)}`));
      });
    });
  }

  async download(url, destination, phase, message) {
    cancelled(this.controller.signal);
    this.send(phase, message);
    const response = await fetch(url, { signal: this.controller.signal });
    if (!response.ok || !response.body) throw new Error(`Official download failed (${response.status}).`);
    const total = Number(response.headers.get('content-length')) || null;
    if (total && total > 2_500_000_000) throw new Error('The download is unexpectedly large.');
    let received = 0;
    let lastUpdate = 0;
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({ transform: (chunk, _encoding, next) => {
        received += chunk.length;
        if (received > 2_500_000_000) return next(new Error('The download exceeded the allowed size.'));
        if (Date.now() - lastUpdate > 400) { this.send(phase, message, { received, total }); lastUpdate = Date.now(); }
        next(null, chunk);
      } }),
      fs.createWriteStream(destination),
      { signal: this.controller.signal }
    );
    this.send(phase, message, { received, total });
  }

  async verifyOllamaSignature(file) {
    const literal = file.replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath '${literal}'; [pscustomobject]@{ Status=[string]$s.Status; Subject=[string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress`;
    // A parent process can prepend incompatible PowerShell modules to PSModulePath.
    // Use the Windows PowerShell system modules for Authenticode verification.
    const systemModules = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
    const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 30000, windowsHide: true, env: { ...process.env, PSModulePath: systemModules } });
    const signature = JSON.parse(result.stdout.trim());
    if (signature.Status !== 'Valid' || !/ollama/i.test(signature.Subject)) throw new Error(`The Ollama installer did not have a valid Ollama publisher signature (status: ${signature.Status}; signer: ${String(signature.Subject).slice(0, 100)}). It was not opened.`);
  }

  async startOrInstallOllama(baseURL) {
    const ready = async () => {
      try { await this.ollamaRequest(baseURL, 'api/tags', { signal: AbortSignal.timeout(3500) }); return true; }
      catch { return false; }
    };
    if (await ready()) return;
    localServerEndpoint(baseURL);
    let appPath = await ollamaPath();
    if (!appPath) {
      fs.mkdirSync(this.toolsRoot, { recursive: true });
      const installer = ownedPath(this.toolsRoot, path.join(this.toolsRoot, `OllamaSetup-${crypto.randomUUID()}.exe`));
      try {
        await this.download('https://ollama.com/download/OllamaSetup.exe', installer, 'ollama', 'Downloading the official Ollama installer…');
        this.send('ollama', 'Checking the Ollama publisher signature…');
        await this.verifyOllamaSignature(installer);
        // The signed installer starts the tray app after setup. An inherited
        // output pipe can stay open for the lifetime of that background app.
        await this.run(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], 'ollama',
          'Installing Ollama for this Windows user…', { stdio: 'ignore' });
      } finally { if (fs.existsSync(installer)) fs.rmSync(installer, { force: true }); }
      if (await ready()) return;
      appPath = await ollamaPath();
      if (!appPath) throw new Error('Ollama installer finished, but the application was not found. Open it once and use Refresh.');
    }
    const { executable, args, host } = ollamaLaunch(appPath, baseURL);
    cancelled(this.controller.signal);
    this.send('ollama', 'Starting Ollama and waiting for its local API…');
    const child = spawn(executable, args, { detached: true, windowsHide: true, stdio: 'ignore',
      env: host ? { ...process.env, OLLAMA_HOST: host } : process.env });
    try {
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
      for (let index = 0; index < 45; index++) {
        cancelled(this.controller.signal);
        if (await ready()) return;
        if (host && child.exitCode !== null) throw new Error('The Ollama server exited before its local API responded.');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('Ollama is installed but its local API did not start. Open Ollama and retry.');
    } catch (error) {
      if (host && child.pid && child.exitCode === null && !child.killed) child.kill();
      throw error;
    } finally { child.unref(); }
  }

  async installUV() {
    const artifact = UV_ARTIFACTS[process.arch];
    if (!artifact) throw new Error(`Automatic MinerU installation does not support ${process.arch} Windows.`);
    const uvDir = path.join(this.toolsRoot, 'uv', UV_VERSION);
    const uv = path.join(uvDir, 'uv.exe');
    if (fs.existsSync(uv)) {
      try { await this.run(uv, ['--version'], 'mineru', 'Checking the managed Python environment tool…'); return uv; }
      catch (error) { if (this.controller.signal.aborted) throw error; fs.rmSync(uv, { force: true }); }
    }
    fs.mkdirSync(uvDir, { recursive: true });
    const archive = ownedPath(this.toolsRoot, path.join(this.toolsRoot, `uv-${crypto.randomUUID()}.zip`));
    const extraction = ownedPath(this.toolsRoot, path.join(this.toolsRoot, `uv-extract-${crypto.randomUUID()}`));
    fs.mkdirSync(extraction);
    try {
      await this.download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${artifact.name}`, archive, 'mineru', 'Downloading the verified Python environment tool…');
      if (await sha256(archive) !== artifact.sha256) throw new Error('The uv download failed its SHA-256 check. It was not opened.');
      await this.run('tar.exe', ['-xf', archive, '-C', extraction], 'mineru', 'Extracting the verified Python environment tool…');
      const files = [path.join(extraction, 'uv.exe'), ...fs.readdirSync(extraction, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => path.join(extraction, item.name, 'uv.exe'))];
      const source = files.find(fs.existsSync);
      if (!source) throw new Error('The verified uv archive did not contain uv.exe.');
      fs.copyFileSync(source, uv);
      await this.run(uv, ['--version'], 'mineru', 'Checking the Python environment tool…');
      return uv;
    } finally {
      if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
      if (fs.existsSync(extraction)) fs.rmSync(extraction, { recursive: true, force: true });
    }
  }

  checkMineruRuntime(executable, kitExecutable, backend) {
    return mineruRuntime(executable, this.toolsRoot, { found: { compatible: true, executable, kitExecutable }, signal: this.controller.signal, backend });
  }

  async installMineru(gpu, useOnnx = process.arch === 'x64' && !gpu.index, backend) {
    const paths = mineruPaths(this.toolsRoot);
    const release = claimMineruSetup(paths.root);
    if (!release) throw new Error('MinerU setup is running in another operation. Wait for it to finish.');
    try { return await this.installMineruEnvironment(paths, gpu, useOnnx, backend); }
    finally { release(); }
  }

  async installMineruEnvironment(paths, gpu, useOnnx, backend) {
    const { final, staging, retired, legacyBackup } = paths;
    const environment = { ...(useOnnx ? mineru4Environment(this.toolsRoot, backend) : process.env), UV_PYTHON_INSTALL_DIR: path.join(this.toolsRoot, 'python'), UV_CACHE_DIR: path.join(this.toolsRoot, 'cache'), UV_NO_PROGRESS: '1', UV_HTTP_TIMEOUT: '600' };
    const versionArgs = useOnnx ? ['version', '--json'] : ['--version'];
    recoverMineru(paths);
    if (fs.existsSync(legacyBackup)) {
      let finalWorks = false;
      if (fs.existsSync(final)) {
        try {
          const executable = path.join(final, 'Scripts', 'mineru.exe');
          const detected = await detectMineruExecutable(executable, this.toolsRoot, { repairOwner: true });
          finalWorks = detected.compatible && (await mineruRuntime(executable, this.toolsRoot, { found: detected, backend })).checked === true;
        }
        catch { /* Recover the last working installation after an interrupted activation. */ }
      }
      if (!finalWorks) {
        removeEnvironment(final);
        fs.renameSync(legacyBackup, final);
      }
    }
    removeEnvironment(staging);
    const uv = await this.installUV();
    try {
      let managedPython = managedPythonPath(this.toolsRoot);
      if (!managedPython) {
        try { await this.run(uv, ['python', 'install', '3.12'], 'mineru', 'Installing an isolated Python 3.12 runtime…', { env: environment }); }
        catch (error) {
          if (this.controller.signal.aborted || !managedPythonPath(this.toolsRoot)) throw error;
          // uv can extract Python successfully, then fail while making its minor-version junction.
          this.send('mineru', 'Python was extracted; checking its interpreter directly…');
        }
        managedPython = managedPythonPath(this.toolsRoot);
      }
      if (!managedPython) throw new Error('The managed Python 3.12 interpreter was not found.');
      await this.run(managedPython, ['-c', 'import ssl, venv; print("Python 3.12 runtime ready")'], 'mineru', 'Verifying the isolated Python runtime…', { env: environment });
      await this.run(uv, ['venv', '--relocatable', '--python', managedPython, staging], 'mineru', 'Creating a private MinerU environment…', { env: environment });
      const python = path.join(staging, 'Scripts', 'python.exe');
      let gpuWarning = '';
      if (gpu.index && !useOnnx) {
        try {
          // MinerU 3.4's Windows LMDeploy extra caps Torch at 2.8 and TorchVision at 0.23.
          await this.run(uv, ['pip', 'install', '--python', python, 'torch==2.8.0', 'torchvision==0.23.0', '--index-url', `https://download.pytorch.org/whl/${gpu.index}`], 'cuda', `Installing PyTorch ${gpu.index} for NVIDIA…`, { env: environment });
        } catch (error) {
          if (this.controller.signal.aborted) throw error;
          gpuWarning = `CUDA package installation failed; MinerU will use its CPU path. ${error.message.slice(0, 180)}`;
          this.send('cuda', gpuWarning);
        }
      }
      const requirement = useOnnx ? `mineru==${MINERU_ONNX_VERSION}` : `mineru[all]==${MINERU_VERSION}`;
      await this.run(uv, ['pip', 'install', '--python', python, requirement], 'mineru', 'Installing MinerU and its parsing components…', { env: environment });
      const stagedExe = path.join(staging, 'Scripts', 'mineru.exe');
      await this.run(stagedExe, versionArgs, 'mineru', 'Verifying the MinerU command…', { env: environment });
      if (useOnnx) await this.run(path.join(staging, 'Scripts', 'mineru-kit.exe'), ['parse', '--help'], 'mineru', 'Verifying the local ONNX parser…', { env: environment });
      cancelled(this.controller.signal);
      this.send('mineru', 'Activating the verified MinerU environment…');
      beginMineruActivation(paths);
      const executable = path.join(final, 'Scripts', 'mineru.exe');
      const kitExecutable = useOnnx ? path.join(final, 'Scripts', 'mineru-kit.exe') : '';
      let runtime;
      try {
        await activateStagedMineru(staging, final, this.controller.signal);
        await this.run(executable, versionArgs, 'mineru', 'Checking the active MinerU installation…', { env: environment });
        if (kitExecutable) await this.run(kitExecutable, ['parse', '--help'], 'mineru', 'Checking the active ONNX parser…', { env: environment });
        this.send('mineru', 'Checking the active MinerU runtime and graphics backend…');
        runtime = await this.checkMineruRuntime(executable, kitExecutable, backend);
        cancelled(this.controller.signal);
        if (!runtime?.checked) throw new Error(runtime?.reason || 'MinerU runtime verification failed.');
        commitMineruActivation(paths);
      } catch (error) {
        rollbackMineru(paths);
        throw error;
      }
      if (gpu.index && !useOnnx && !runtime.cuda) gpuWarning ||= 'MinerU installed, but PyTorch did not confirm CUDA. Parsing will use its available CPU path.';
      const warnings = gpuWarning ? [gpuWarning] : [];
      try { removeEnvironment(retired); removeEnvironment(legacyBackup); }
      catch { warnings.push('MinerU is installed. The previous environment could not be cleaned up.'); }
      const downloader = path.join(final, 'Scripts', useOnnx ? 'mineru-kit.exe' : 'mineru-models-download.exe');
      if (fs.existsSync(downloader)) {
        const args = useOnnx ? ['models', 'download', '--tier', 'basic', '--small-backend', 'onnx', '--source', 'auto']
          : ['--source', 'auto', '--model_type', 'pipeline'];
        try { await this.run(downloader, args, 'models', 'Preloading MinerU parsing models; this can take several GB…', { env: environment }); }
        catch {
          warnings.push(this.controller.signal.aborted
            ? 'MinerU is installed. Model preloading was cancelled and will retry when a PDF is parsed.'
            : 'MinerU model preloading did not finish; it will retry when a PDF is parsed.');
        }
      }
      return { executable, runtime, onnx: useOnnx, warning: warnings.join(' ') };
    } finally { removeEnvironment(staging); }
  }

  async install(config) {
    if (this.controller) throw new Error('A setup is already running.');
    const components = selectedComponents(config.components);
    if (components.models && (!Array.isArray(config.models) || config.models.length > 4 || config.models.some(model => typeof model !== 'string' || !/^[\w./:-]{2,100}$/.test(model)))) throw new Error('Choose valid local model names before setup.');
    this.controller = new AbortController();
    try {
      this.send('detect', 'Checking existing local tools and graphics hardware…');
      const status = await this.status(config);
      cancelled(this.controller.signal);
      if ((components.ollama || components.models) && status.plan.ollama) await this.startOrInstallOllama(config.baseURL);
      for (const model of components.models ? status.plan.models : []) {
        cancelled(this.controller.signal);
        this.send('model', `Downloading ${model} into Ollama…`);
        await this.pullModel(config.baseURL, model, this.controller.signal, update => this.send('model', `${model}: ${update.status}`, { received: update.completed || 0, total: update.total || null }));
      }
      let result = { warning: '' };
      if (components.mineru && status.plan.mineru) {
        const useOnnx = process.arch === 'x64' && Boolean(status.mineru.kitExecutable || !status.plan.gpu.index);
        const installed = await this.installMineru(status.plan.gpu, useOnnx, config.mineruBackend);
        const automatic = config.mineruBackend !== 'pipeline' && (installed.onnx || installed.runtime?.cuda);
        result = { mineruInstalled: true, mineruExecutable: installed.executable,
          mineruBackend: automatic ? 'auto' : 'pipeline', warning: installed.warning || '' };
      } else {
        cancelled(this.controller.signal);
        if (components.mineru) Object.assign(result, { mineruInstalled: false, mineruExecutable: status.mineru.executable });
      }
      this.send('done', result.warning || 'Local AI setup is ready.');
      return result;
    } catch (error) {
      this.send(error.name === 'AbortError' ? 'cancelled' : 'error', error.message);
      throw error;
    } finally { this.controller = null; this.child = null; }
  }
}

module.exports = { SetupManager, cudaPlan, setupPlan, versionAtLeast, mineruStatus, managedPythonPath };
