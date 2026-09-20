const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createStore, safeId } = require('./storage.cjs');
const { graphicsStatus, mineruRuntime } = require('./hardware.cjs');
const { SetupManager } = require('./setup.cjs');

let window;
let store;
let activeMineru = null;
let setupManager = null;
const requests = new Map();

function localOllamaURL(value, endpoint) {
  const url = new URL(value || 'http://localhost:11434');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PaperBridge only connects to a local Ollama HTTP server.');
  }
  return new URL(endpoint, url);
}

async function ollamaRequest(baseURL, endpoint, options = {}) {
  let response;
  try { response = await fetch(localOllamaURL(baseURL, endpoint), options); }
  catch { if (options.signal?.aborted && options.signal.reason?.name !== 'TimeoutError') { const error = new Error('Setup cancelled.'); error.name = 'AbortError'; throw error; } throw new Error('Cannot reach local Ollama. Start Ollama, then refresh models.'); }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Ollama ${response.status}: ${message.slice(0, 300)}`);
  }
  return response;
}

function progress(data) { if (window && !window.isDestroyed()) window.webContents.send('paperbridge:progress', data); }

async function pullOllamaModel(baseURL, model, signal, update) {
  if (!/^[\w./:-]{2,100}$/.test(model)) throw new Error('Invalid model name.');
  const response = await ollamaRequest(baseURL, 'api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) if (line.trim()) {
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      update(event);
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    if (event.error) throw new Error(event.error);
    update(event);
  }
  return true;
}

async function findMarkdown(folder) {
  if (!fs.existsSync(folder)) return null;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) { const found = await findMarkdown(full); if (found) return found; }
    else if (entry.name.toLowerCase().endsWith('.md')) return full;
  }
  return null;
}

async function readMineruMarkdown(file) {
  let markdown = fs.readFileSync(file, 'utf8');
  const matches = [...markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  for (const match of matches) {
    const relative = decodeURIComponent(match[2].replace(/^<|>$/g, ''));
    if (/^(?:https?:|data:|file:)/i.test(relative)) continue;
    const candidate = path.resolve(path.dirname(file), relative);
    const allowedRoot = path.resolve(path.dirname(file));
    if (!candidate.startsWith(`${allowedRoot}${path.sep}`) || !fs.existsSync(candidate)) continue;
    const ext = path.extname(candidate).toLowerCase();
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' })[ext];
    if (!mime || fs.statSync(candidate).size > 8_000_000) continue;
    markdown = markdown.replace(match[0], `![${match[1]}](data:${mime};base64,${fs.readFileSync(candidate).toString('base64')})`);
  }
  return markdown;
}

function registerHandlers() {
  ipcMain.handle('bootstrap', () => ({ settings: store.settings(), glossary: store.glossary(), library: store.list() }));
  ipcMain.handle('hardware:status', () => graphicsStatus());
  ipcMain.handle('mineru:runtime', (_event, executable) => mineruRuntime(executable));
  ipcMain.handle('setup:status', (_event, config) => { localOllamaURL(config.baseURL, 'api/tags'); return setupManager.status(config); });
  ipcMain.handle('setup:install', (_event, config) => { localOllamaURL(config.baseURL, 'api/tags'); return setupManager.install(config); });
  ipcMain.handle('setup:cancel', () => setupManager.cancel());
  ipcMain.handle('ollama:running', async (_event, baseURL) => {
    const response = await ollamaRequest(baseURL, 'api/ps');
    const data = await response.json();
    return (data.models || []).map(model => ({ name: model.name || model.model, sizeVram: model.size_vram || 0, size: model.size || 0 }));
  });
  ipcMain.handle('settings:save', (_event, settings) => store.saveSettings(settings));
  ipcMain.handle('glossary:save', (_event, glossary) => store.saveGlossary(glossary));
  ipcMain.handle('paper:load', (_event, id) => store.paper(safeId(id)));
  ipcMain.handle('paper:save', (_event, paper) => { store.savePaper(paper); return store.list(); });
  ipcMain.handle('pdf:import', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open paper', properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    const bytes = fs.readFileSync(source);
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('This file is not a valid PDF.');
    const id = crypto.createHash('sha256').update(bytes).digest('hex');
    const destination = store.pdfPath(id);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
    return { id, name: path.basename(source), existing: store.paper(id), bytes: new Uint8Array(bytes) };
  });
  ipcMain.handle('pdf:read', (_event, id) => new Uint8Array(fs.readFileSync(store.pdfPath(safeId(id)))));
  ipcMain.handle('markdown:export', async (_event, { name, content }) => {
    const result = await dialog.showSaveDialog(window, { title: 'Export Markdown', defaultPath: `${String(name || 'PaperBridge').replace(/[<>:"/\\|?*]/g, '-')}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled) return null;
    fs.writeFileSync(result.filePath, String(content), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('ollama:models', async (_event, baseURL) => {
    const response = await ollamaRequest(baseURL, 'api/tags');
    const data = await response.json();
    return (data.models || []).map(model => model.model || model.name).filter(Boolean);
  });
  ipcMain.handle('ollama:generate', async (_event, { baseURL, model, prompt, system, requestId }) => {
    if (typeof model !== 'string' || !model.trim() || typeof prompt !== 'string' || typeof requestId !== 'string') throw new Error('Invalid Ollama request.');
    const controller = new AbortController();
    requests.set(requestId, controller);
    try {
      const response = await ollamaRequest(baseURL, 'api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, system, stream: false, options: { temperature: 0.1 } }),
        signal: controller.signal
      });
      const data = await response.json();
      if (data.done === false || data.done_reason === 'length') throw new Error('Model response was cut off. Try a smaller paragraph.');
      if (data.error) throw new Error(data.error);
      if (!data.response?.trim()) throw new Error('Ollama returned an empty response.');
      return data.response.trim();
    } finally { requests.delete(requestId); }
  });
  ipcMain.handle('ollama:cancel', (_event, requestId) => { requests.get(requestId)?.abort(); });
  ipcMain.handle('mineru:cancel', () => { activeMineru?.kill(); });
  ipcMain.handle('ollama:pull', async (_event, { baseURL, model }) => {
    return pullOllamaModel(baseURL, model, null, event => progress({ kind: 'model', model, status: event.status, completed: event.completed, total: event.total }));
  });
  ipcMain.handle('mineru:extract', async (_event, { id, executable, backend }) => {
    const pdf = store.pdfPath(safeId(id));
    if (!fs.existsSync(pdf)) throw new Error('Original PDF is missing.');
    const command = String(executable || 'mineru').trim();
    const output = path.join(store.root, 'mineru', id);
    fs.mkdirSync(output, { recursive: true });
    await new Promise((resolve, reject) => {
      const args = ['-p', pdf, '-o', output];
      if (backend === 'pipeline') args.push('-b', 'pipeline');
      const child = spawn(command, args, { shell: false, windowsHide: true });
      activeMineru = child;
      let log = '';
      child.stdout.on('data', data => { log += data.toString(); progress({ kind: 'mineru', status: data.toString().trim().slice(-200) }); });
      child.stderr.on('data', data => { log += data.toString(); progress({ kind: 'mineru', status: data.toString().trim().slice(-200) }); });
      child.on('error', error => { if (activeMineru === child) activeMineru = null; reject(new Error(`MinerU could not start: ${error.message}`)); });
      child.on('close', code => { if (activeMineru === child) activeMineru = null; code === 0 ? resolve() : reject(new Error(`MinerU exited ${code}: ${log.slice(-500)}`)); });
    });
    const file = await findMarkdown(output);
    if (!file) throw new Error('MinerU finished without a Markdown file.');
    return readMineruMarkdown(file);
  });
  ipcMain.handle('external:ollama', () => shell.openExternal('https://ollama.com/download/windows'));
}

function createWindow() {
  window = new BrowserWindow({
    width: 1320, height: 820, minWidth: 980, minHeight: 620, title: 'PaperBridge',
    backgroundColor: '#F3EEE4',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else if (!app.isPackaged && process.env.NODE_ENV !== 'production') window.loadURL('http://127.0.0.1:5173');
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  app.setName('PaperBridge');
  store = createStore(process.env.PAPERBRIDGE_WORKSPACE || path.join(app.getPath('userData'), 'workspace'));
  setupManager = new SetupManager({
    toolsRoot: process.env.PAPERBRIDGE_TOOLS_ROOT || path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'PaperBridge', 'tools'),
    ollamaRequest,
    pullModel: pullOllamaModel,
    emit: progress
  });
  registerHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { setupManager?.cancel(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { localOllamaURL };
