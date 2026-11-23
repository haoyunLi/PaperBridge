const { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { externalPaperURL } = require('./paper-link.mjs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createStore, safeId, bootstrapSnapshot } = require('./storage.cjs');
const { graphicsStatus } = require('./hardware.cjs');
const { SetupManager, mineruStatus } = require('./setup.cjs');
const { requestGeneration } = require('./ollama-generation.cjs');
const { ollamaRequest } = require('./ollama-http.cjs');
const { localOllamaURL } = require('./ollama-installation.cjs');
const { readOllamaModelList } = require('./ollama-models.mjs');
const { createMineruStaging, detectMineruExecutable, mineruInvocation } = require('./mineru-discovery.cjs');
const { findMineruMarkdown, readMineruMarkdown, readMineruPageHints, unpackMineruArchive } = require('./mineru-output.cjs');
const { openPaperAttachment } = require('./paper-attachment.cjs');
const { keepMineruResult, findPaperMineruMarkdown, removeMineruResult } = require('./mineru-resources.cjs');
const { createMineruJobGuard } = require('./mineru-job.cjs');
const { writeBundle, writeBundleFacsimile, pageImageName, maximumPreviewPages, safeName } = require('./bundle.cjs');
const { createPageArchive, validPageImage } = require('./pdf-page-archive.cjs');
const { importPdfAsset, selectIndependentPdfAsset } = require('./pdf-ingest.cjs');
const { createUpdateChecker, releaseUrl, updateDownload } = require('./updates.cjs');
const { UpdateDownload, chromiumTransfer } = require('./update-download.cjs');
const { createModelPullManager, pullOllamaModel } = require('./model-pull.cjs');
const { normalizeMenuState, menuCommandState, applyMenuState } = require('./menu-state.cjs');
const { createOfficialLinkHandler } = require('./official-links.cjs');
const { createOpenAICredentialStore, createOpenAIClient } = require('./openai.cjs');
const developmentBuild = !app.isPackaged && process.env.NODE_ENV !== 'production';
const readerURL = developmentBuild ? new URL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173').href
  : pathToFileURL(path.join(app.getAppPath(), 'dist', 'index.html')).href;

let window;
let store;
let updateFiles;
const mineruJobs = createMineruJobGuard();
const pendingMineruResults = new Map();
let setupManager = null;
let setupOperation = null;
let setupChangesMineru = false;
let waitingForSetupQuit = false;
let openAICredentials = null;
let openAIClient = null;
let openAIConsent = false;
let openAIRevision = 0;
let activeBundle = null;
let activeImportArchive = null;
let menuState = normalizeMenuState({});
let closeReady = false;
let closeRequested = false;
let quitAfterClose = false;
let closeTimer = null;
const requests = new Map();
const openAIRequests = new Map();
const modelPullManager = createModelPullManager({ pullModel: pullOllamaModel, emit: progress, isSetupBusy: () => Boolean(setupManager?.controller) });

function pageBundle(id, folder) {
  if (!activeBundle || id !== activeBundle.id || folder !== activeBundle.folder) throw new Error('No matching page-image export is active.');
  return activeBundle;
}

function revealBundle(folder) {
  try {
    if (fs.lstatSync(folder).isDirectory()) shell.showItemInFolder(folder);
  } catch { /* The bundle is saved even when File Explorer cannot select it. */ }
}

function revokeOpenAIConsent() {
  openAIConsent = false;
  openAIRevision += 1;
  for (const controller of openAIRequests.values()) controller.abort();
  openAIRequests.clear();
}

function finishClose() {
  closeReady = true;
  closeRequested = false;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  if (quitAfterClose) app.quit();
  else if (window && !window.isDestroyed()) window.close();
}

function requestRendererClose(quitting = false) {
  quitAfterClose ||= quitting;
  if (closeRequested || !window || window.isDestroyed()) return;
  if (window.webContents.isCrashed()) { finishClose(); return; }
  closeRequested = true;
  window.webContents.send('paperbridge:prepare-close');
  closeTimer = setTimeout(finishClose, 10_000);
}

function cancelRendererClose() {
  closeRequested = false;
  quitAfterClose = false;
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
}

function progress(data) {
  if (window && !window.isDestroyed() && !window.webContents.isCrashed()) window.webContents.send('paperbridge:progress', data);
}

function importPdfBytes(bytes, name) {
  const imported = importPdfAsset(bytes, name, store.pdfPath);
  return { ...imported, existing: store.paper(imported.id) };
}

function registerHandlers() {
  const checkUpdates = createUpdateChecker({ store, currentVersion: () => app.getVersion() });
  ipcMain.handle('menu:update-state', (event, state) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Menu state must come from the main app window.');
    menuState = normalizeMenuState(state);
    return applyMenuState(Menu.getApplicationMenu(), menuState);
  });
  ipcMain.on('app:close-ready', event => { if (event.sender === window?.webContents) finishClose(); });
  ipcMain.on('app:close-cancelled', event => { if (event.sender === window?.webContents) cancelRendererClose(); });
  ipcMain.handle('bootstrap', () => bootstrapSnapshot(store, app.getVersion()));
  let availableDownload = null;
  let refreshedLegacyTag = null;
  const backgroundUpdatesEnabled = () => {
    const prefs = store.settings();
    return prefs.autoCheckUpdates !== false && prefs.autoDownloadUpdates === true;
  };
  ipcMain.handle('updates:check', async (_event, automatic = false) => {
    const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
    let result = await checkUpdates(automatic);
    if (result.status === 'skipped') return result;
    let candidate = updateDownload(result, portable);
    if (candidate && !candidate.file && result.fromCache && !result.stale && backgroundUpdatesEnabled() && refreshedLegacyTag !== result.tag) {
      refreshedLegacyTag = result.tag;
      // Before 0.2.29 the daily cache contained filenames only. Fetch current
      // release evidence once when an existing user opts into background downloads.
      try { result = await checkUpdates(false); candidate = updateDownload(result, portable); } catch { /* Keep the browser download available offline. */ }
    }
    availableDownload = candidate;
    if (candidate && backgroundUpdatesEnabled()) void updateFiles.prepare(candidate);
    else if (!updateFiles.matches(candidate)) updateFiles.cancel();
    const canOpenInstaller = Boolean(app.isPackaged && !portable && candidate?.file?.name === `PaperBridge-Windows-${result.latestVersion}-x64-Setup.exe`);
    return { ...result, downloadLabel: candidate?.label, downloadInApp: Boolean(candidate?.file), canOpenInstaller,
      updateFile: updateFiles.state };
  });
  ipcMain.handle('updates:reveal', (_event, tag) => updateFiles.show(tag));
  ipcMain.handle('updates:install', (event, tag) => {
    if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE || event.sender !== window?.webContents ||
        event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url.split('#')[0] !== readerURL ||
        availableDownload?.tag !== tag || !updateFiles.matches(availableDownload)) throw new Error('The installed reader needs a current verified Setup update.');
    return updateFiles.openInstaller(tag, filename => shell.openPath(filename));
  });
  ipcMain.handle('updates:download', (_event, tag) => {
    if (!availableDownload || availableDownload.tag !== tag) throw new Error('Check for updates to find the current download.');
    if (availableDownload.file) return updateFiles.prepare(availableDownload, { manual: true });
    return shell.openExternal(availableDownload.url);
  });
  ipcMain.handle('updates:open-release', (_event, tag) => shell.openExternal(releaseUrl(tag)));
  ipcMain.handle('hardware:status', () => graphicsStatus());
  ipcMain.handle('mineru:runtime', async (_event, executable, backend) => {
    const found = await mineruStatus(executable, setupManager.toolsRoot, backend);
    return found.runtime ?? { checked: false, reason: found.reason };
  });
  ipcMain.handle('mineru:status', (_event, executable, backend) => mineruStatus(executable, setupManager.toolsRoot, backend));
  ipcMain.handle('mineru:detect', (_event, backend) => mineruStatus('', setupManager.toolsRoot, backend));
  ipcMain.handle('setup:status', (_event, config) => { localOllamaURL(config.baseURL, 'api/tags'); return setupManager.status(config); });
  ipcMain.handle('setup:install', (_event, config) => {
    if (modelPullManager.busy) throw new Error('A model download is already running. Cancel it or wait before starting Local AI setup.');
    if (setupOperation) throw new Error('A setup is already running.');
    localOllamaURL(config.baseURL, 'api/tags');
    const changesMineru = config.components == null || config.components.mineru === true;
    if (changesMineru && mineruJobs.busy) throw new Error('Finish or stop the current PDF extraction before installing MinerU.');
    setupChangesMineru = changesMineru;
    setupOperation = setupManager.install(config).finally(() => { setupOperation = null; setupChangesMineru = false; });
    return setupOperation;
  });
  ipcMain.handle('setup:cancel', () => setupManager.cancel());
  async function runningModels(baseURL) {
    const response = await ollamaRequest(baseURL, 'api/ps', { signal: AbortSignal.timeout(3500) });
    const data = await response.json();
    if (!Array.isArray(data?.models)) throw new Error('Ollama did not return its loaded models.');
    return data.models.filter(model => typeof (model?.name || model?.model) === 'string').map(model => ({
      name: model.name || model.model,
      sizeVram: Number.isSafeInteger(model.size_vram) && model.size_vram >= 0 ? model.size_vram : null,
      size: Number.isSafeInteger(model.size) && model.size > 0 ? model.size : null
    }));
  }
  ipcMain.handle('ollama:running', (_event, baseURL) => runningModels(baseURL));
  ipcMain.handle('ollama:unload', async (_event, baseURL, name) => {
    const loaded = await runningModels(baseURL);
    if (!loaded.some(model => model.name === name)) return;
    if (requests.size || modelPullManager.busy || setupManager?.controller) throw new Error('Finish the current local AI task before releasing model memory.');
    const response = await ollamaRequest(baseURL, 'api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ model: name, keep_alive: 0, stream: false })
    });
    const result = await response.json();
    if (result.error || result.done !== true) throw new Error(result.error || 'Ollama did not confirm the unload request.');
  });
  ipcMain.handle('settings:save', (_event, settings) => {
    store.saveSettings(settings);
    if ((settings.autoCheckUpdates === false || settings.autoDownloadUpdates !== true) && updateFiles.state.phase === 'downloading' && !updateFiles.manual) updateFiles.cancel();
  });
  ipcMain.handle('openai:key-status', () => ({ hasKey: openAICredentials.status() }));
  ipcMain.handle('openai:key-save', (_event, key) => {
    openAICredentials.save(key);
    revokeOpenAIConsent();
    return { hasKey: true, consent: false };
  });
  ipcMain.handle('openai:key-remove', () => {
    openAICredentials.remove();
    revokeOpenAIConsent();
    return { hasKey: false, consent: false };
  });
  ipcMain.handle('openai:consent', (_event, enabled) => {
    if (enabled !== true) { revokeOpenAIConsent(); return false; }
    if (!openAICredentials.status()) throw new Error('Save an OpenAI API key in Settings > Models first.');
    openAIRevision += 1;
    openAIConsent = true;
    return true;
  });
  ipcMain.handle('openai:models', async (_event, requestId) => {
    if (typeof requestId !== 'string' || !requestId) throw new Error('Invalid OpenAI model request.');
    const controller = new AbortController();
    openAIRequests.set(requestId, controller);
    try { return await openAIClient.listModels(openAICredentials.read(), controller.signal); }
    finally { openAIRequests.delete(requestId); }
  });
  ipcMain.handle('openai:generate', async (_event, { model, prompt, system, requestId }) => {
    if (!openAIConsent) throw new Error('Open Settings > Models to allow sending text to OpenAI for this session. Nothing was sent.');
    if (typeof requestId !== 'string' || !requestId) throw new Error('Invalid OpenAI request.');
    const revision = openAIRevision;
    const controller = new AbortController();
    openAIRequests.set(requestId, controller);
    try {
      const result = await openAIClient.generate({ apiKey: openAICredentials.read(), model, prompt, system, signal: controller.signal });
      if (!openAIConsent || revision !== openAIRevision) throw new Error('Cancelled');
      return result;
    } finally { openAIRequests.delete(requestId); }
  });
  ipcMain.handle('openai:cancel', (_event, requestId) => { openAIRequests.get(requestId)?.abort(); });
  ipcMain.handle('glossary:save', (_event, glossary) => store.saveGlossary(glossary));
  ipcMain.handle('paper:load', (_event, id) => store.paper(safeId(id)));
  ipcMain.handle('paper:mark-opened', (_event, id) => store.markPaperOpened(id));
  ipcMain.handle('paper:update-library-metadata', (_event, payload) => store.updateLibraryMetadata(payload));
  ipcMain.handle('paper:save', (event, paper) => {
    store.savePaper(paper, () => {
      // The saved document owns its OCR files even if updating the library index fails.
      const pending = pendingMineruResults.get(paper.mineruResourceId);
      if (pending && pending.sender === event.sender && pending.id === paper.id) pendingMineruResults.delete(paper.mineruResourceId);
    });
    return store.list();
  });
  ipcMain.handle('paper:clear-data', () => {
    activeImportArchive = null;
    revokeOpenAIConsent();
    updateFiles.cancel();
    availableDownload = null;
    mineruJobs.cancel();
    pendingMineruResults.clear();
    store.clearData();
  });
  ipcMain.handle('pdf:import', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open paper', properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    return importPdfBytes(fs.readFileSync(source), path.basename(source));
  });
  ipcMain.handle('pdf:import-bytes', (_event, { bytes, name }) => importPdfBytes(bytes, name));
  ipcMain.handle('pdf:copy-as-new', () => selectIndependentPdfAsset({
    showOpenDialog: (owner, options) => dialog.showOpenDialog(owner, options), owner: window, pdfPath: store.pdfPath
  }));
  ipcMain.handle('pdf:read', (_event, id) => new Uint8Array(fs.readFileSync(store.pdfPath(safeId(id)))));
  ipcMain.handle('pdf:prepare-page-archive', async (event, { id, fingerprint, pageCount, requestId }) => {
    const pdfFile = store.pdfPath(safeId(id));
    if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)
        || !Number.isSafeInteger(pageCount) || pageCount < 1 || typeof requestId !== 'string' || !requestId) {
      throw new Error('Invalid PDF page archive request.');
    }
    const job = { requestId, sender: event.sender, limit: Math.min(pageCount, maximumPreviewPages) };
    activeImportArchive = job;
    const archive = await createPageArchive(store.root, pdfFile, {
      expectedFingerprint: fingerprint, isCurrent: () => activeImportArchive === job && !event.sender.isDestroyed()
    });
    if (!archive || activeImportArchive !== job) return null;
    job.archive = archive;
    archive.savePageCount(pageCount);
    return { cachedPages: archive.status().cachedPages, limit: job.limit };
  });
  ipcMain.handle('pdf:archive-page', (event, { requestId, pageNumber, bytes }) => {
    const job = activeImportArchive;
    if (!job?.archive || requestId !== job.requestId || event.sender !== job.sender) return false;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > job.limit) throw new Error('Invalid PDF page number.');
    if (bytes == null) return Boolean(job.archive.readPage(pageNumber));
    const png = bytes instanceof Uint8Array ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
    if (!png || !validPageImage(png)) throw new Error('Invalid page image.');
    return job.archive.savePage(pageNumber, png);
  });
  ipcMain.handle('pdf:finish-page-archive', (event, requestId) => {
    if (activeImportArchive && activeImportArchive.requestId === requestId && activeImportArchive.sender === event.sender) activeImportArchive = null;
  });
  ipcMain.handle('markdown:export', async (_event, { name, content }) => {
    const stem = safeName(String(name || 'PaperBridge').replace(/\.md$/i, ''));
    const result = await dialog.showSaveDialog(window, { title: 'Export Markdown', defaultPath: `${stem}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled) return null;
    fs.writeFileSync(result.filePath, String(content), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('markdown:bundle', async (_event, { paper, documents }) => {
    safeId(paper.id);
    if (!Array.isArray(documents) || documents.length > 8 || documents.some(item => typeof item.name !== 'string' || typeof item.content !== 'string'
        || item.filename != null && typeof item.filename !== 'string')) throw new Error('Invalid Markdown bundle.');
    const result = await dialog.showOpenDialog(window, { title: 'Choose export folder', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const sourceMode = paper.sourceMode === 'mineru' ? 'mineru' : undefined;
    const original = documents.find(document => document.kind === 'original');
    const markdown = sourceMode && findPaperMineruMarkdown(store.root, { ...paper, mineruMarkdown: original?.content });
    const bundle = writeBundle(result.filePaths[0], { name: paper.name, type: paper.type, sourceMode, facsimile: paper.facsimile === true },
      documents, store.pdfPath(paper.id), markdown ? path.dirname(markdown) : null);
    const { facsimileDocuments, ...report } = bundle;
    const pdfFile = bundle.originalPdf ? path.join(bundle.folder, 'original.pdf') : null;
    const archive = pdfFile ? await createPageArchive(store.root, pdfFile) : null;
    activeBundle = pdfFile ? { id: paper.id, folder: bundle.folder, pdfFile, archive, facsimileDocuments, renderedPages: new Set() } : null;
    if (!pdfFile) revealBundle(bundle.folder);
    return { ...report, maximumPreviewPages, ...archive?.status() };
  });
  ipcMain.handle('markdown:bundle-pdf', (_event, { id, folder }) => {
    const { pdfFile, archive } = pageBundle(id, folder);
    const bytes = fs.readFileSync(pdfFile);
    if (archive && !archive.matches(bytes)) throw new Error('The exported original PDF changed during export.');
    return new Uint8Array(bytes);
  });
  ipcMain.handle('markdown:bundle-page', (_event, { id, folder, pageNumber, bytes }) => {
    const { archive, renderedPages } = pageBundle(id, folder);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > maximumPreviewPages) throw new Error('Invalid PDF page number.');
    const cached = bytes == null;
    if (!cached && !(bytes instanceof Uint8Array)) throw new Error('Invalid page image.');
    const png = cached ? archive?.readPage(pageNumber) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (cached && !png) return false;
    if (!validPageImage(png)) throw new Error('Invalid page image.');
    const pages = path.join(folder, 'pages');
    fs.mkdirSync(pages, { recursive: true });
    fs.writeFileSync(path.join(pages, pageImageName(pageNumber)), png);
    renderedPages.add(pageNumber);
    if (!cached) archive?.savePage(pageNumber, png);
    return true;
  });
  ipcMain.handle('markdown:bundle-finish', (_event, { id, folder, pageCount, stopped, completed }) => {
    const bundle = pageBundle(id, folder);
    if (!Number.isSafeInteger(pageCount) || pageCount < 0) throw new Error('Invalid PDF page count.');
    activeBundle = null;
    writeBundleFacsimile(bundle, pageCount, stopped === true);
    bundle.archive?.savePageCount(pageCount);
    if (completed === true && stopped !== true) revealBundle(bundle.folder);
  });
  ipcMain.handle('ollama:models', async (_event, baseURL) => {
    const response = await ollamaRequest(baseURL, 'api/tags', { signal: AbortSignal.timeout(10000) });
    return readOllamaModelList(response);
  });
  ipcMain.handle('ollama:generate', async (_event, { baseURL, model, prompt, system, requestId, format }) => {
    if (typeof model !== 'string' || !model.trim() || typeof prompt !== 'string' || typeof requestId !== 'string') throw new Error('Invalid Ollama request.');
    const controller = new AbortController();
    requests.set(requestId, controller);
    try {
      const data = await requestGeneration(baseURL, {
        model, prompt, system, stream: false, ...(format === 'json' ? { format: 'json' } : {}),
        options: { temperature: 0.1, ...(format === 'json' ? { num_predict: 2048 } : {}) }
      }, controller.signal);
      if (data.done === false || data.done_reason === 'length') {
        throw new Error(format === 'json' ? 'The summary response was cut off. Choose a different summary model in Settings and try again.' : 'Model response was cut off. Try a smaller paragraph.');
      }
      if (data.error) throw new Error(data.error);
      if (!data.response?.trim()) throw new Error('Ollama returned an empty response.');
      return data.response.trim();
    } finally { requests.delete(requestId); }
  });
  ipcMain.handle('ollama:cancel', (_event, requestId) => { requests.get(requestId)?.abort(); });
  ipcMain.handle('mineru:cancel', () => mineruJobs.cancel());
  ipcMain.handle('mineru:discard-result', (event, { id, resourceId }) => {
    const pending = pendingMineruResults.get(resourceId);
    if (!pending || pending.sender !== event.sender || pending.id !== id) return;
    pendingMineruResults.delete(resourceId);
    removeMineruResult(store.root, resourceId);
  });
  ipcMain.handle('mineru:cached-pages', (_event, id) => {
    const file = findPaperMineruMarkdown(store.root, store.paper(safeId(id)));
    return file ? readMineruPageHints(file) : [];
  });
  ipcMain.handle('ollama:pull', (_event, payload) => modelPullManager.pull(payload));
  ipcMain.handle('ollama:cancel-pull', () => modelPullManager.cancel());
  ipcMain.handle('mineru:extract', async (event, { id, executable, backend, requestId, cpuFallback }) => {
    if (setupChangesMineru) throw new Error('Finish or cancel the current MinerU setup before extracting a PDF.');
    const pdf = store.pdfPath(safeId(id));
    if (!fs.existsSync(pdf)) throw new Error('Original PDF is missing.');
    const job = mineruJobs.begin();
    const reportProgress = status => { if (!job.cancelled) progress({ kind: 'mineru', requestId, status }); };
    let staging = null;
    try {
      const detected = await detectMineruExecutable(executable, setupManager.toolsRoot);
      mineruJobs.check(job);
      if (!detected.compatible) throw new Error(detected.reason);
      // MinerU repeats the input stem inside its temporary result paths. A SHA-256
      // filename can push these paths past the Windows path limit, so use a short
      // private input name while retaining the unchanged original in our library.
      staging = createMineruStaging(detected, os.tmpdir(), process.env.LOCALAPPDATA);
      const stagedPdf = path.join(staging.directory, 'paper.pdf');
      const output = path.join(staging.directory, 'output');
      fs.copyFileSync(pdf, stagedPdf);
      const invocation = mineruInvocation(detected, stagedPdf, output, backend, setupManager.toolsRoot, cpuFallback === true);
      await new Promise((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, { shell: false, windowsHide: true, env: invocation.env });
        mineruJobs.attach(job, child);
        let log = '';
        const appendLog = data => {
          const text = data.toString();
          log = (log + text).slice(-10000);
          reportProgress(text.trim().slice(-200));
        };
        child.stdout.on('data', appendLog);
        child.stderr.on('data', appendLog);
        child.on('error', error => { mineruJobs.detach(job, child); reject(new Error(`MinerU could not start: ${error.message}`)); });
        child.on('close', code => { mineruJobs.detach(job, child); code === 0 ? resolve() : reject(new Error(`MinerU exited ${code}: ${log.slice(-2000)}`)); });
      });
      mineruJobs.check(job);
      const file = detected.kitExecutable
        ? await unpackMineruArchive(path.join(output, 'paper.zip'), path.join(staging.directory, 'result'), () => mineruJobs.check(job))
        : findMineruMarkdown(output, path.parse(stagedPdf).name);
      mineruJobs.check(job);
      if (!file) throw new Error('MinerU finished without a Markdown file.');
      const markdown = readMineruMarkdown(file);
      const pageHints = readMineruPageHints(file);
      mineruJobs.check(job);
      if (event.sender.isDestroyed()) throw new Error('The paper window was closed.');
      let resourceId = null;
      let resourceWarning = '';
      try {
        resourceId = keepMineruResult(store.root, id, file, markdown);
        pendingMineruResults.set(resourceId, { id, sender: event.sender });
      } catch {
        resourceWarning = 'MinerU text is ready, but its local resource files could not be saved.';
      }
      return { markdown, pageHints, resourceId, resourceWarning };
    } finally {
      mineruJobs.finish(job);
      if (staging) {
        const resolved = path.resolve(staging.directory);
        if (path.dirname(resolved) !== staging.root || !path.basename(resolved).startsWith('paperbridge-mineru-')) throw new Error('Unexpected MinerU staging path.');
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  });
  ipcMain.handle('paper:attachment', (event, { id, href, from = '' }) => {
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url.split('#')[0] !== readerURL) throw new Error('Open attachments from the PaperBridge reader.');
    return openPaperAttachment(store.root, store.paper(safeId(id)), href, from, file => shell.openPath(file));
  });
  ipcMain.on('paper:open-link', (event, href) => {
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url.split('#')[0] !== readerURL) return;
    const url = externalPaperURL(href);
    if (url) shell.openExternal(url).catch(error => dialog.showErrorBox('Could not open the paper link', error.message));
  });
  ipcMain.handle('external:ollama', () => shell.openExternal('https://ollama.com/download/windows'));
}

function buildMenu() {
  const action = (label, command, accelerator) => ({ id: `command:${command}`, label, enabled: menuCommandState(menuState)[command], ...(accelerator ? { accelerator } : {}), click: () => {
    if (menuCommandState(menuState)[command] && window && !window.isDestroyed()) window.webContents.send('paperbridge:command', command);
  } });
  return Menu.buildFromTemplate([
    { label: 'File', submenu: [
      action('Open PDF…', 'openPdf', 'CmdOrCtrl+O'),
      action('Export Markdown or Bundle…', 'export', 'CmdOrCtrl+Shift+E'),
      { type: 'separator' }, { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+W' }, { role: 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'Paper', submenu: [
      action('Back to Previous Reading Location', 'readingBack', 'CmdOrCtrl+['),
      action('Forward in Reading History', 'readingForward', 'CmdOrCtrl+]'),
      { type: 'separator' },
      action('Paper Library', 'library', 'CmdOrCtrl+Shift+L'),
      action('Saved Terminology', 'glossary'),
      { type: 'separator' },
      action('Show Overview', 'summary', 'CmdOrCtrl+1'),
      action('Find in Paper', 'find', 'CmdOrCtrl+F'),
      action('Undo Paragraph Edit', 'undoParagraph'),
      action('Run Current Workspace Task', 'primaryTask', 'CmdOrCtrl+Return'),
      action('Generate Summary', 'generateSummary'),
      action('Generate Full Translation', 'generateFullTranslation')
    ] },
    { label: 'Selection', submenu: [
      action('Undo Highlight or Note Change', 'undoAnnotation'),
      action('Undo Last Workspace Change', 'undo'),
      { type: 'separator' },
      action('Translate Selection', 'translateSelection', 'CmdOrCtrl+Shift+T'),
      action('Explain Selection', 'explainSelection', 'CmdOrCtrl+Alt+E'),
      action('Highlight Selection', 'highlightSelection', 'CmdOrCtrl+Shift+H')
    ] },
    { label: 'View', submenu: [
      action('Focus Reading', 'focusReading', 'CmdOrCtrl+Alt+F'),
      action('Toggle Document Sidebar', 'toggleSidebar', 'CmdOrCtrl+Alt+S'),
      action('Show Research Inspector', 'inspector', 'CmdOrCtrl+Shift+I'),
      { role: 'togglefullscreen', label: 'Full Screen', accelerator: 'F11' },
      { type: 'separator' },
      action('Settings', 'settings', 'CmdOrCtrl+,')
    ] },
    { label: 'Help', submenu: [
      action('PaperBridge Getting Started…', 'onboarding'),
      action('Local AI Setup…', 'setup'),
      action('Check for Updates…', 'checkUpdates'),
      { type: 'separator' }, { role: 'about', label: 'About PaperBridge' }
    ] }
  ]);
}

function createWindow() {
  closeReady = false;
  cancelRendererClose();
  window = new BrowserWindow({
    width: 1320, height: 820, minWidth: 980, minHeight: 620, title: developmentBuild ? 'PaperBridge Dev' : 'PaperBridge',
    backgroundColor: '#F3EEE4',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(createOfficialLinkHandler(
    url => shell.openExternal(url),
    error => dialog.showErrorBox('Could not open the official website', error.message)
  ));
  menuState = normalizeMenuState({});
  Menu.setApplicationMenu(buildMenu());
  window.webContents.on('did-start-loading', () => {
    menuState = normalizeMenuState({});
    applyMenuState(Menu.getApplicationMenu(), menuState);
  });
  const contents = window.webContents;
  // A browser destination should never replace the reading workspace.
  contents.on('will-navigate', event => {
    if (event.url.split('#')[0] !== readerURL) event.preventDefault();
  });
  const owner = window;
  let processLosses = 0;
  function loadReader() {
    const generation = processLosses;
    // The portable extraction path can use a Windows short name. Load the exact
    // URL used by the navigation and IPC checks, including when the reader retries.
    const navigation = owner.loadURL(readerURL);
    return navigation.catch(error => {
      // A reload, closed window or renderer recovery can supersede the first navigation.
      if (generation === processLosses && error.code !== 'ERR_ABORTED' && error.errno !== -3) throw error;
    });
  }
  function discardPendingResults() {
    for (const [resourceId, pending] of pendingMineruResults) {
      if (pending.sender !== contents) continue;
      pendingMineruResults.delete(resourceId);
      removeMineruResult(store.root, resourceId);
    }
  }
  contents.once('destroyed', discardPendingResults);
  contents.on('render-process-gone', (_event, { reason, exitCode }) => {
    processLosses++;
    if (reason === 'clean-exit' || owner.isDestroyed() || closeReady) return;
    revokeOpenAIConsent();
    for (const controller of requests.values()) controller.abort();
    modelPullManager.cancel();
    mineruJobs.cancel();
    setupManager?.cancel();
    activeImportArchive = null;
    activeBundle = null;
    discardPendingResults();
    if (closeRequested) { finishClose(); return; }
    const generation = processLosses;
    void dialog.showMessageBox(owner, {
      type: 'error', title: 'PaperBridge reader stopped', message: 'The reader closed unexpectedly.',
      detail: `Reopen the reader to return to your last saved workspace.\n\nThe reader reported ${reason} (exit code ${exitCode}).`,
      buttons: ['Reopen reader', 'Close PaperBridge'], defaultId: 0, cancelId: 1, noLink: true
    }).then(({ response }) => {
      if (owner.isDestroyed() || generation !== processLosses || closeReady || closeRequested) return;
      if (response === 0) return loadReader();
      quitAfterClose = true;
      finishClose();
    }).catch(showStartupError);
  });
  window.on('close', event => {
    if (closeReady) return;
    event.preventDefault();
    requestRendererClose(false);
  });
  return loadReader();
}

function showStartupError(error) {
  dialog.showErrorBox('PaperBridge could not open', error.message || String(error));
  app.exit(1);
}

// A second Explorer launch should bring the existing reader back to the front.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.whenReady().then(startApp).catch(showStartupError);
}

async function startApp() {
  app.setName(developmentBuild ? 'PaperBridge Dev' : 'PaperBridge');
  app.setAboutPanelOptions({ applicationName: app.getName(), applicationVersion: app.getVersion() });
  if (developmentBuild && !process.env.PAPERBRIDGE_WORKSPACE) app.setPath('userData', path.join(app.getPath('appData'), 'PaperBridge Dev'));
  store = createStore(process.env.PAPERBRIDGE_WORKSPACE || path.join(app.getPath('userData'), 'workspace'));
  const updateRoot = process.env.PAPERBRIDGE_WORKSPACE || path.join(process.env.LOCALAPPDATA || app.getPath('userData'), app.getName());
  updateFiles = new UpdateDownload({ directory: path.join(updateRoot, 'update-downloads'),
    transfer: chromiumTransfer(session.fromPartition('paperbridge-update-downloads')),
    notify: state => { if (window && !window.isDestroyed() && !window.webContents.isCrashed()) window.webContents.send('updates:file-state', state); },
    reveal: filename => shell.showItemInFolder(filename), currentVersion: app.getVersion(), runningPortable: process.env.PORTABLE_EXECUTABLE_FILE });
  openAICredentials = createOpenAICredentialStore({ file: path.join(store.root, 'openai-key.bin'), safeStorage });
  openAIClient = createOpenAIClient();
  setupManager = new SetupManager({
    toolsRoot: process.env.PAPERBRIDGE_TOOLS_ROOT || path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'PaperBridge', 'tools'),
    ollamaRequest,
    pullModel: pullOllamaModel,
    emit: progress
  });
  registerHandlers();
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(showStartupError); });
}
app.on('before-quit', event => {
  if (window && !window.isDestroyed() && !closeReady) {
    event.preventDefault();
    requestRendererClose(true);
    return;
  }
  if (setupOperation) {
    event.preventDefault();
    if (!waitingForSetupQuit) {
      waitingForSetupQuit = true;
      setupManager.cancel();
      void setupOperation.then(() => app.quit(), () => app.quit());
    }
    return;
  }
  updateFiles?.cancel();
  modelPullManager.cancel(); mineruJobs.cancel(); revokeOpenAIConsent();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { localOllamaURL };
