const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { graphicsStatus, mineruRuntime } = require('./hardware.cjs');

const exec = promisify(execFile);
const UV_VERSION = '0.11.29';
const UV_ARTIFACTS = {
  x64: { name: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'a047d55651bc3e0ca24595b25ec4cfcb10f9dca9fb56514e661269b37d4fae68' },
  arm64: { name: 'uv-aarch64-pc-windows-msvc.zip', sha256: '55b597ae81bc29531a7c352a1431a8a73cc2755d7a5b9ec454580cbe02e5154f' }
};
const MINERU_VERSION = '3.4.5'; // This app currently uses the MinerU 3.x CLI (-p, -o, -b).

function versionAtLeast(actual, minimum) {
  const a = String(actual || '').split('.').map(Number);
  const b = minimum.split('.').map(Number);
  return a[0] > b[0] || (a[0] === b[0] && (a[1] || 0) >= (b[1] || 0));
}

function cudaPlan(hardware) {
  if (!hardware?.cudaDriver?.length) return { index: null, reason: hardware?.adapters?.some(item => item.vendor === 'AMD') ? 'AMD is not a CUDA device. Ollama can choose supported AMD acceleration; MinerU uses its CPU pipeline.' : 'No NVIDIA CUDA driver was detected; MinerU uses its CPU pipeline.' };
  if (versionAtLeast(hardware.cudaVersion, '12.8')) return { index: 'cu128', reason: `NVIDIA CUDA ${hardware.cudaVersion}: install matching PyTorch CUDA wheels in the managed MinerU environment.` };
  if (versionAtLeast(hardware.cudaVersion, '12.6')) return { index: 'cu126', reason: `NVIDIA CUDA ${hardware.cudaVersion}: install matching PyTorch CUDA wheels in the managed MinerU environment.` };
  return { index: null, reason: `NVIDIA driver reports CUDA ${hardware.cudaVersion || 'unknown'}. Update the driver to enable automatic MinerU CUDA setup; CPU parsing remains available.` };
}

function setupPlan(status, requiredModels) {
  const models = [...new Set(requiredModels)].filter(model => !status.ollama.models.includes(model));
  const gpu = cudaPlan(status.hardware);
  return {
    ollama: !status.ollama.running,
    models,
    mineru: !status.mineru.compatible || Boolean(gpu.index && !status.mineru.runtime?.cuda),
    gpu
  };
}

function cancelled(signal) {
  if (signal?.aborted) { const error = new Error('Setup cancelled. You can resume it later.'); error.name = 'AbortError'; throw error; }
}

async function where(command) {
  try { return (await exec('where.exe', [command], { timeout: 3000, windowsHide: true })).stdout.split(/\r?\n/).find(value => value && fs.existsSync(value)) || ''; }
  catch { return ''; }
}

async function ollamaAppPath() {
  const local = process.env.LOCALAPPDATA || '';
  const candidate = local && path.join(local, 'Programs', 'Ollama', 'ollama app.exe');
  if (candidate && fs.existsSync(candidate)) return candidate;
  return where('ollama app.exe');
}

async function mineruPath(configured, toolsRoot) {
  const candidates = [configured, path.join(toolsRoot, 'mineru', 'Scripts', 'mineru.exe'), await where('mineru.exe')];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}

async function mineruStatus(configured, toolsRoot) {
  const executable = await mineruPath(configured, toolsRoot);
  if (!executable) return { installed: false, compatible: false, executable: '', version: '', runtime: null };
  let version = '';
  try {
    const result = await exec(executable, ['--version'], { timeout: 15000, windowsHide: true });
    version = (result.stdout || result.stderr).trim().slice(0, 200);
  } catch { return { installed: true, compatible: false, executable, version: 'The command did not start', runtime: null }; }
  const compatible = /(?:^|\D)3\.\d+/.test(version);
  return { installed: true, compatible, executable, version, runtime: compatible ? await mineruRuntime(executable) : null };
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
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

  async status({ baseURL, mineruExecutable, models }) {
    const [hardware, mineru, appPath, response] = await Promise.all([
      graphicsStatus(), mineruStatus(mineruExecutable, this.toolsRoot), ollamaAppPath(),
      this.ollamaRequest(baseURL, 'api/tags', { signal: AbortSignal.timeout(3500) }).then(async value => ({ running: true, models: (await value.json()).models?.map(item => item.model || item.name).filter(Boolean) || [] })).catch(error => ({ running: false, models: [], error: error.message }))
    ]);
    const result = { hardware, mineru, ollama: { installed: Boolean(appPath), path: appPath, ...response } };
    result.plan = setupPlan(result, models);
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
    const script = `$s=Get-AuthenticodeSignature -LiteralPath '${literal}'; [pscustomobject]@{ Status=[string]$s.Status; Subject=[string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress`;
    const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 30000, windowsHide: true });
    const signature = JSON.parse(result.stdout.trim());
    if (signature.Status !== 'Valid' || !/ollama/i.test(signature.Subject)) throw new Error('The Ollama installer did not have a valid Ollama publisher signature. It was not opened.');
  }

  async startOrInstallOllama(baseURL) {
    let appPath = await ollamaAppPath();
    if (!appPath) {
      fs.mkdirSync(this.toolsRoot, { recursive: true });
      const installer = ownedPath(this.toolsRoot, path.join(this.toolsRoot, `OllamaSetup-${crypto.randomUUID()}.exe`));
      try {
        await this.download('https://ollama.com/download/OllamaSetup.exe', installer, 'ollama', 'Downloading the official Ollama installer…');
        this.send('ollama', 'Checking the Ollama publisher signature…');
        await this.verifyOllamaSignature(installer);
        await this.run(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], 'ollama', 'Installing Ollama for this Windows user…');
      } finally { if (fs.existsSync(installer)) fs.rmSync(installer, { force: true }); }
      appPath = await ollamaAppPath();
      if (!appPath) throw new Error('Ollama installer finished, but the application was not found. Open it once and use Refresh.');
    }
    let ready = false;
    try { await this.ollamaRequest(baseURL, 'api/tags', { signal: AbortSignal.timeout(3500) }); ready = true; } catch { /* Start existing installation. */ }
    if (!ready) {
      this.send('ollama', 'Starting Ollama and waiting for its local API…');
      await new Promise((resolve, reject) => {
        const child = spawn(appPath, [], { detached: true, windowsHide: true, stdio: 'ignore' });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      for (let index = 0; index < 45; index++) {
        cancelled(this.controller.signal);
        try { await this.ollamaRequest(baseURL, 'api/tags', { signal: AbortSignal.timeout(3500) }); ready = true; break; } catch { /* Keep waiting. */ }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (!ready) throw new Error('Ollama is installed but its local API did not start. Open Ollama and retry.');
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

  async installMineru(gpu) {
    const uv = await this.installUV();
    const final = ownedPath(this.toolsRoot, path.join(this.toolsRoot, 'mineru'));
    const staging = ownedPath(this.toolsRoot, path.join(this.toolsRoot, 'mineru.installing'));
    const backup = ownedPath(this.toolsRoot, path.join(this.toolsRoot, 'mineru.backup'));
    const environment = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(this.toolsRoot, 'python'), UV_CACHE_DIR: path.join(this.toolsRoot, 'cache'), UV_NO_PROGRESS: '1', UV_HTTP_TIMEOUT: '600' };
    if (fs.existsSync(backup)) {
      let finalWorks = false;
      if (fs.existsSync(final)) {
        try { await exec(path.join(final, 'Scripts', 'mineru.exe'), ['--version'], { timeout: 15000, windowsHide: true }); finalWorks = true; }
        catch { /* Recover the last working installation after an interrupted activation. */ }
      }
      if (!finalWorks) {
        if (fs.existsSync(final)) fs.rmSync(final, { recursive: true, force: true });
        fs.renameSync(backup, final);
      }
    }
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    try {
      await this.run(uv, ['python', 'install', '3.12'], 'mineru', 'Installing an isolated Python 3.12 runtime…', { env: environment });
      await this.run(uv, ['venv', '--relocatable', '--python', '3.12', staging], 'mineru', 'Creating a private MinerU environment…', { env: environment });
      const python = path.join(staging, 'Scripts', 'python.exe');
      let gpuWarning = '';
      if (gpu.index) {
        try {
          // MinerU 3.4's Windows LMDeploy extra caps Torch at 2.8 and TorchVision at 0.23.
          await this.run(uv, ['pip', 'install', '--python', python, 'torch==2.8.0', 'torchvision==0.23.0', '--index-url', `https://download.pytorch.org/whl/${gpu.index}`], 'cuda', `Installing PyTorch ${gpu.index} for NVIDIA…`, { env: environment });
        } catch (error) {
          if (this.controller.signal.aborted) throw error;
          gpuWarning = `CUDA package installation failed; MinerU will use its CPU path. ${error.message.slice(0, 180)}`;
          this.send('cuda', gpuWarning);
        }
      }
      await this.run(uv, ['pip', 'install', '--python', python, `mineru[all]==${MINERU_VERSION}`], 'mineru', 'Installing MinerU and its parsing components…', { env: environment });
      const stagedExe = path.join(staging, 'Scripts', 'mineru.exe');
      await this.run(stagedExe, ['--version'], 'mineru', 'Verifying the MinerU command…', { env: environment });
      cancelled(this.controller.signal);
      this.send('mineru', 'Activating the verified MinerU environment…');
      if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
      if (fs.existsSync(final)) fs.renameSync(final, backup);
      try {
        fs.renameSync(staging, final);
        const executable = path.join(final, 'Scripts', 'mineru.exe');
        await this.run(executable, ['--version'], 'mineru', 'Checking the active MinerU installation…', { env: environment });
      } catch (error) {
        if (fs.existsSync(final)) fs.rmSync(final, { recursive: true, force: true });
        if (fs.existsSync(backup)) fs.renameSync(backup, final);
        throw error;
      }
      if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
      const executable = path.join(final, 'Scripts', 'mineru.exe');
      const runtime = await mineruRuntime(executable);
      if (gpu.index && !runtime.cuda) gpuWarning ||= 'MinerU installed, but PyTorch did not confirm CUDA. Parsing will use its available CPU path.';
      const downloader = path.join(final, 'Scripts', 'mineru-models-download.exe');
      if (fs.existsSync(downloader)) {
        try { await this.run(downloader, ['--source', 'auto', '--model_type', 'pipeline'], 'models', 'Preloading MinerU pipeline models; this can take several GB…', { env: environment }); }
        catch (error) { if (this.controller.signal.aborted) throw error; gpuWarning += `${gpuWarning ? ' ' : ''}MinerU model preloading did not finish; it will retry when a PDF is parsed.`; }
      }
      return { executable, runtime, warning: gpuWarning };
    } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true }); }
  }

  async install(config) {
    if (this.controller) throw new Error('A setup is already running.');
    if (!Array.isArray(config.models) || config.models.length > 3 || config.models.some(model => typeof model !== 'string' || !/^[\w./:-]{2,100}$/.test(model))) throw new Error('Choose valid local model names before setup.');
    this.controller = new AbortController();
    try {
      this.send('detect', 'Checking existing local tools and graphics hardware…');
      const status = await this.status(config);
      let mineruExecutable = status.mineru.executable;
      let mineruCuda = Boolean(status.mineru.runtime?.cuda);
      let warning = '';
      if (status.plan.ollama) await this.startOrInstallOllama(config.baseURL);
      for (const model of status.plan.models) {
        cancelled(this.controller.signal);
        this.send('model', `Downloading ${model} into Ollama…`);
        await this.pullModel(config.baseURL, model, this.controller.signal, update => this.send('model', `${model}: ${update.status}`, { received: update.completed || 0, total: update.total || null }));
      }
      if (status.plan.mineru) {
        const result = await this.installMineru(status.plan.gpu);
        mineruExecutable = result.executable;
        mineruCuda = Boolean(result.runtime?.cuda);
        warning = result.warning;
      }
      this.send('done', warning || 'Local AI setup is ready.');
      return { mineruExecutable, mineruBackend: mineruCuda ? 'auto' : 'pipeline', warning };
    } catch (error) {
      this.send(error.name === 'AbortError' ? 'cancelled' : 'error', error.message);
      throw error;
    } finally { this.controller = null; this.child = null; }
  }
}

module.exports = { SetupManager, cudaPlan, setupPlan, versionAtLeast };
