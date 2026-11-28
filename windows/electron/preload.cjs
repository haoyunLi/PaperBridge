const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('paperBridge', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  updateMenuState: state => ipcRenderer.invoke('menu:update-state', state),
  checkUpdates: automatic => ipcRenderer.invoke('updates:check', automatic),
  skipUpdate: tag => ipcRenderer.invoke('updates:skip', tag),
  revealUpdate: tag => ipcRenderer.invoke('updates:reveal', tag),
  openUpdateInstaller: tag => ipcRenderer.invoke('updates:install', tag),
  closeForPortableUpdate: tag => ipcRenderer.invoke('updates:close-for-portable', tag),
  onUpdateFile: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:file-state', listener);
    return () => ipcRenderer.removeListener('updates:file-state', listener);
  },
  cancelUpdateDownload: tag => ipcRenderer.invoke('updates:cancel-download', tag),
  downloadUpdate: tag => ipcRenderer.invoke('updates:download', tag),
  openUpdateRelease: tag => ipcRenderer.invoke('updates:open-release', tag),
  openPaperAttachment: (id, href, from) => ipcRenderer.invoke('paper:attachment', { id, href, from }),
  openPaperLink: href => ipcRenderer.send('paper:open-link', href),
  importPdf: () => ipcRenderer.invoke('pdf:import'),
  importPdfBytes: payload => ipcRenderer.invoke('pdf:import-bytes', payload),
  copyPdfAsNew: id => ipcRenderer.invoke('pdf:copy-as-new', id),
  discardNewPdfCopy: id => ipcRenderer.invoke('pdf:discard-new-copy', id),
  readPdf: id => ipcRenderer.invoke('pdf:read', id),
  preparePageArchive: payload => ipcRenderer.invoke('pdf:prepare-page-archive', payload),
  archivePdfPage: payload => ipcRenderer.invoke('pdf:archive-page', payload),
  finishPageArchive: requestId => ipcRenderer.invoke('pdf:finish-page-archive', requestId),
  savePaper: paper => ipcRenderer.invoke('paper:save', paper),
  closeReady: () => ipcRenderer.send('app:close-ready'),
  closeCancelled: () => ipcRenderer.send('app:close-cancelled'),
  retryArchiveCleanup: () => ipcRenderer.invoke('paper:retry-archive-cleanup'),
  clearData: includeArchivedPdfs => ipcRenderer.invoke('paper:clear-data', includeArchivedPdfs === true),
  loadPaper: id => ipcRenderer.invoke('paper:load', id),
  markPaperOpened: id => ipcRenderer.invoke('paper:mark-opened', id),
  updateLibraryMetadata: payload => ipcRenderer.invoke('paper:update-library-metadata', payload),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  openAIKeyStatus: () => ipcRenderer.invoke('openai:key-status'),
  saveOpenAIKey: key => ipcRenderer.invoke('openai:key-save', key),
  removeOpenAIKey: () => ipcRenderer.invoke('openai:key-remove'),
  setOpenAIConsent: enabled => ipcRenderer.invoke('openai:consent', enabled),
  listOpenAIModels: requestId => ipcRenderer.invoke('openai:models', requestId),
  generateOpenAI: payload => ipcRenderer.invoke('openai:generate', payload),
  cancelOpenAI: requestId => ipcRenderer.invoke('openai:cancel', requestId),
  saveGlossary: glossary => ipcRenderer.invoke('glossary:save', glossary),
  exportMarkdown: payload => ipcRenderer.invoke('markdown:export', payload),
  exportBundle: payload => ipcRenderer.invoke('markdown:bundle', payload),
  readBundlePdf: payload => ipcRenderer.invoke('markdown:bundle-pdf', payload),
  exportBundlePage: payload => ipcRenderer.invoke('markdown:bundle-page', payload),
  finishBundle: payload => ipcRenderer.invoke('markdown:bundle-finish', payload),
  listModels: baseURL => ipcRenderer.invoke('ollama:models', baseURL),
  runningModels: baseURL => ipcRenderer.invoke('ollama:running', baseURL),
  unloadModel: (baseURL, name) => ipcRenderer.invoke('ollama:unload', baseURL, name),
  graphicsStatus: () => ipcRenderer.invoke('hardware:status'),
  mineruRuntime: (executable, backend) => ipcRenderer.invoke('mineru:runtime', executable, backend),
  mineruStatus: (executable, backend) => ipcRenderer.invoke('mineru:status', executable, backend),
  detectMineru: backend => ipcRenderer.invoke('mineru:detect', backend),
  setupStatus: config => ipcRenderer.invoke('setup:status', config),
  setupInstall: config => ipcRenderer.invoke('setup:install', config),
  setupCancel: () => ipcRenderer.invoke('setup:cancel'),
  generate: payload => ipcRenderer.invoke('ollama:generate', payload),
  cancel: requestId => ipcRenderer.invoke('ollama:cancel', requestId),
  cancelMineru: () => ipcRenderer.invoke('mineru:cancel'),
  pullModel: payload => ipcRenderer.invoke('ollama:pull', payload),
  cancelPullModel: () => ipcRenderer.invoke('ollama:cancel-pull'),
  extractMineru: payload => ipcRenderer.invoke('mineru:extract', payload),
  discardMineruResult: payload => ipcRenderer.invoke('mineru:discard-result', payload),
  cachedMineruPages: id => ipcRenderer.invoke('mineru:cached-pages', id),
  onProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('paperbridge:progress', listener);
    return () => ipcRenderer.removeListener('paperbridge:progress', listener);
  },
  onCommand: callback => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('paperbridge:command', listener);
    return () => ipcRenderer.removeListener('paperbridge:command', listener);
  },
  onPrepareClose: callback => {
    const listener = () => callback();
    ipcRenderer.on('paperbridge:prepare-close', listener);
    return () => ipcRenderer.removeListener('paperbridge:prepare-close', listener);
  }
});
