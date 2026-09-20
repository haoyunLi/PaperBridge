const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('paperBridge', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  importPdf: () => ipcRenderer.invoke('pdf:import'),
  readPdf: id => ipcRenderer.invoke('pdf:read', id),
  savePaper: paper => ipcRenderer.invoke('paper:save', paper),
  loadPaper: id => ipcRenderer.invoke('paper:load', id),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  saveGlossary: glossary => ipcRenderer.invoke('glossary:save', glossary),
  exportMarkdown: payload => ipcRenderer.invoke('markdown:export', payload),
  listModels: baseURL => ipcRenderer.invoke('ollama:models', baseURL),
  runningModels: baseURL => ipcRenderer.invoke('ollama:running', baseURL),
  graphicsStatus: () => ipcRenderer.invoke('hardware:status'),
  mineruRuntime: executable => ipcRenderer.invoke('mineru:runtime', executable),
  generate: payload => ipcRenderer.invoke('ollama:generate', payload),
  cancel: requestId => ipcRenderer.invoke('ollama:cancel', requestId),
  cancelMineru: () => ipcRenderer.invoke('mineru:cancel'),
  pullModel: payload => ipcRenderer.invoke('ollama:pull', payload),
  extractMineru: payload => ipcRenderer.invoke('mineru:extract', payload),
  onProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('paperbridge:progress', listener);
    return () => ipcRenderer.removeListener('paperbridge:progress', listener);
  }
});
