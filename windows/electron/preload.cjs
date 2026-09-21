const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('paperBridge', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  updateMenuState: state => ipcRenderer.invoke('menu:update-state', state),
  checkUpdates: automatic => ipcRenderer.invoke('updates:check', automatic),
  openUpdateRelease: tag => ipcRenderer.invoke('updates:open-release', tag),
  importPdf: () => ipcRenderer.invoke('pdf:import'),
  importPdfBytes: payload => ipcRenderer.invoke('pdf:import-bytes', payload),
  copyPdfAsNew: payload => ipcRenderer.invoke('pdf:copy-as-new', payload),
  readPdf: id => ipcRenderer.invoke('pdf:read', id),
  savePaper: paper => ipcRenderer.invoke('paper:save', paper),
  closeReady: () => ipcRenderer.send('app:close-ready'),
  closeCancelled: () => ipcRenderer.send('app:close-cancelled'),
  clearData: () => ipcRenderer.invoke('paper:clear-data'),
  loadPaper: id => ipcRenderer.invoke('paper:load', id),
  markPaperOpened: id => ipcRenderer.invoke('paper:mark-opened', id),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  saveGlossary: glossary => ipcRenderer.invoke('glossary:save', glossary),
  exportMarkdown: payload => ipcRenderer.invoke('markdown:export', payload),
  exportBundle: payload => ipcRenderer.invoke('markdown:bundle', payload),
  exportBundlePage: payload => ipcRenderer.invoke('markdown:bundle-page', payload),
  listModels: baseURL => ipcRenderer.invoke('ollama:models', baseURL),
  runningModels: baseURL => ipcRenderer.invoke('ollama:running', baseURL),
  graphicsStatus: () => ipcRenderer.invoke('hardware:status'),
  mineruRuntime: executable => ipcRenderer.invoke('mineru:runtime', executable),
  mineruStatus: executable => ipcRenderer.invoke('mineru:status', executable),
  detectMineru: () => ipcRenderer.invoke('mineru:detect'),
  setupStatus: config => ipcRenderer.invoke('setup:status', config),
  setupInstall: config => ipcRenderer.invoke('setup:install', config),
  setupCancel: () => ipcRenderer.invoke('setup:cancel'),
  generate: payload => ipcRenderer.invoke('ollama:generate', payload),
  cancel: requestId => ipcRenderer.invoke('ollama:cancel', requestId),
  cancelMineru: () => ipcRenderer.invoke('mineru:cancel'),
  pullModel: payload => ipcRenderer.invoke('ollama:pull', payload),
  cancelPullModel: () => ipcRenderer.invoke('ollama:cancel-pull'),
  extractMineru: payload => ipcRenderer.invoke('mineru:extract', payload),
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
