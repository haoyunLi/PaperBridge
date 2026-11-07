const fs = require('node:fs');
const path = require('node:path');
const readingAppearanceDefaults = require('./reading-appearance.json');
const { normalizeReadingAppearance } = require('./reading-appearance.mjs');
const { clearPageArchives } = require('./pdf-page-archive.cjs');

const defaults = {
  aiProvider: 'ollama',
  openAITranslationModel: '',
  openAISummaryModel: '',
  openAIExplainModel: '',
  openAIQuickLookupModel: '',
  translationStyleGuide: '',
  ollamaBaseURL: 'http://localhost:11434',
  translationModel: 'translategemma:4b',
  summaryModel: 'translategemma:4b',
  explainModel: 'translategemma:4b',
  sourceLanguage: 'English',
  targetLanguage: 'Simplified Chinese',
  maxParagraphChars: 1800,
  ...readingAppearanceDefaults,
  mineruExecutable: '',
  mineruBackend: 'auto',
  pdfExtractionMode: 'mineruPreferred',
  quickLookupModel: 'translategemma:4b',
  autoCheckUpdates: true,
  onboardingCompletedVersion: 0,
  onboardingPage: 0,
  setupComponents: { ollama: true, models: true, mineru: true }
};

function safeId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid paper ID');
  return id;
}

function readJson(file, fallback) {
  for (const candidate of [file, `${file}.backup`]) {
    try { return JSON.parse(fs.readFileSync(candidate, 'utf8')); } catch { /* try backup */ }
  }
  return fallback;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  if (fs.existsSync(file)) {
    try { JSON.parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, `${file}.backup`); } catch { /* retain older backup */ }
  }
  fs.renameSync(temporary, file);
}

const LIBRARY_INDEX_VERSION = 1;

function validPaper(value, id) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.id === id &&
    Array.isArray(value.blocks) && value.blocks.every(block => block && typeof block === 'object' && !Array.isArray(block))
    ? value : null;
}

function readValidPaper(file, id) {
  for (const candidate of [file, `${file}.backup`]) {
    try {
      const paper = validPaper(JSON.parse(fs.readFileSync(candidate, 'utf8')), id);
      if (paper) return paper;
    } catch { /* try backup */ }
  }
  return null;
}

function normalizeLibraryTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].slice(0, 20);
}

function normalizeLibraryIndex(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== LIBRARY_INDEX_VERSION ||
      !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) return null;
  const entries = {};
  for (const [id, entry] of Object.entries(value.entries)) {
    if (!/^[a-f0-9]{64}$/.test(id) || !entry || typeof entry !== 'object' || Array.isArray(entry) || entry.id !== id ||
        typeof entry.documentName !== 'string' || typeof entry.libraryTitle !== 'string' || !Array.isArray(entry.tags) ||
        !entry.tags.every(tag => typeof tag === 'string') || typeof entry.createdAt !== 'string' ||
        typeof entry.updatedAt !== 'string' || typeof entry.type !== 'string' || !Number.isInteger(entry.blockCount) ||
        !Number.isInteger(entry.translatedCount)) return null;
    entries[id] = { ...entry, tags: normalizeLibraryTags(entry.tags) };
  }
  return { version: LIBRARY_INDEX_VERSION, entries };
}

function readLibraryIndex(file) {
  for (const candidate of [file, `${file}.backup`]) {
    try {
      const value = normalizeLibraryIndex(JSON.parse(fs.readFileSync(candidate, 'utf8')));
      if (value) return value;
    } catch { /* try backup */ }
  }
  return { version: LIBRARY_INDEX_VERSION, entries: {} };
}

function libraryEntryFromPaper(paper, existing = null) {
  const blocks = Array.isArray(paper.blocks) ? paper.blocks : [];
  const documentName = typeof paper.name === 'string' && paper.name ? paper.name : existing?.documentName || 'Untitled paper';
  return {
    id: paper.id,
    documentName,
    libraryTitle: existing ? existing.libraryTitle : typeof paper.libraryTitle === 'string' ? paper.libraryTitle.trim() : '',
    tags: existing ? existing.tags : normalizeLibraryTags(paper.tags),
    createdAt: typeof paper.createdAt === 'string' ? paper.createdAt : existing?.createdAt || '',
    updatedAt: typeof paper.updatedAt === 'string' ? paper.updatedAt : existing?.updatedAt || '',
    type: typeof paper.type === 'string' ? paper.type : existing?.type || '',
    blockCount: blocks.length,
    translatedCount: blocks.filter(block => block && block.status === 'ok').length
  };
}

function createStore(root) {
  const papersDir = path.join(root, 'papers');
  const pdfDir = path.join(root, 'pdfs');
  const lastPaperFile = path.join(root, 'last-paper.json');
  const libraryIndexFile = path.join(root, 'library-index.json');
  let libraryPersistenceWarning = '';
  const paperPath = id => path.join(papersDir, `${safeId(id)}.json`);
  const pdfPath = id => path.join(pdfDir, `${safeId(id)}.pdf`);
  const readablePapers = () => {
    const papers = new Map();
    if (!fs.existsSync(papersDir)) return papers;
    const ids = new Set(fs.readdirSync(papersDir).map(name => name.match(/^([a-f0-9]{64})\.json(?:\.backup)?$/)?.[1]).filter(Boolean));
    for (const id of ids) {
      const paper = readValidPaper(paperPath(id), id);
      if (paper) papers.set(id, paper);
    }
    return papers;
  };
  const reconcileLibraryIndex = ({ tolerateWriteFailure = false } = {}) => {
    const index = readLibraryIndex(libraryIndexFile);
    const papers = readablePapers();
    let changed = false;
    for (const [id, paper] of papers) {
      const next = libraryEntryFromPaper(paper, index.entries[id]);
      if (JSON.stringify(index.entries[id]) !== JSON.stringify(next)) { index.entries[id] = next; changed = true; }
    }
    if (changed) {
      try { writeJson(libraryIndexFile, index); }
      catch (error) {
        if (!tolerateWriteFailure) throw error;
        libraryPersistenceWarning = 'Library labels and metadata were not persisted. Fix the storage issue, then retry.';
      }
    }
    return { index, papers };
  };
  const listLibrary = () => {
    libraryPersistenceWarning = '';
    const { index, papers } = reconcileLibraryIndex({ tolerateWriteFailure: true });
    const recent = readJson(lastPaperFile, {});
    return Object.values(index.entries).map(entry => {
      const opened = recent?.openedAt?.[entry.id];
      return { id: entry.id, name: entry.libraryTitle || entry.documentName, tags: [...entry.tags], createdAt: entry.createdAt,
        updatedAt: entry.updatedAt, type: entry.type, lastOpened: typeof opened === 'string' ? opened : null,
        blockCount: entry.blockCount, translatedCount: entry.translatedCount, workspaceAvailable: papers.has(entry.id) };
    }).sort((a, b) => Number(b.id === recent?.id) - Number(a.id === recent?.id)
      || (b.lastOpened || b.createdAt || b.updatedAt || '').localeCompare(a.lastOpened || a.createdAt || a.updatedAt || ''));
  };
  return {
    root,
    pdfPath,
    settings() {
      const saved = readJson(path.join(root, 'settings.json'), {});
      const { apiKey, openAIAPIKey, openAIConsent, isOpenAIOptInConfirmed, ...safe } = saved && typeof saved === 'object' ? saved : {};
      return { ...defaults, ...safe, ...normalizeReadingAppearance(safe), aiProvider: safe.aiProvider === 'openai' ? 'openai' : 'ollama', translationStyleGuide: String(safe.translationStyleGuide || '').slice(0, 2000) };
    },
    saveSettings(settings) {
      const { apiKey, openAIAPIKey, openAIConsent, isOpenAIOptInConfirmed, ...safe } = settings && typeof settings === 'object' ? settings : {};
      writeJson(path.join(root, 'settings.json'), { ...defaults, ...safe, ...normalizeReadingAppearance(safe), aiProvider: safe.aiProvider === 'openai' ? 'openai' : 'ollama', translationStyleGuide: String(safe.translationStyleGuide || '').slice(0, 2000) });
    },
    lastUpdateCheckAt() { return Number(readJson(path.join(root, 'updates.json'), {}).lastCheckAt || 0); },
    saveUpdateCheckAt(value) { writeJson(path.join(root, 'updates.json'), { lastCheckAt: value }); },
    updateCheckState() { return readJson(path.join(root, 'updates.json'), {}); },
    saveUpdateCheckState(value) { writeJson(path.join(root, 'updates.json'), value); },
    glossary() {
      const saved = readJson(path.join(root, 'glossary.json'), []);
      return Array.isArray(saved) ? saved.filter(term => typeof term?.source === 'string' && typeof term?.target === 'string') : [];
    },
    saveGlossary(glossary) {
      if (!Array.isArray(glossary) || glossary.length > 500) throw new Error('Invalid terminology list. The limit is 500 terms.');
      writeJson(path.join(root, 'glossary.json'), glossary);
    },
    paper(id) {
      const safe = safeId(id);
      const paper = readValidPaper(paperPath(safe), safe);
      if (!paper) return null;
      const entry = readLibraryIndex(libraryIndexFile).entries[safe];
      return entry ? { ...paper, libraryTitle: entry.libraryTitle, tags: [...entry.tags] } : paper;
    },
    lastPaperId() {
      const id = readJson(lastPaperFile, {})?.id;
      try { return readValidPaper(paperPath(id), id) ? id : null; }
      catch { return null; }
    },
    markPaperOpened(id) {
      safeId(id);
      if (!readValidPaper(paperPath(id), id)) throw new Error('Paper could not be loaded.');
      const previous = readJson(lastPaperFile, {});
      const lastOpened = new Date().toISOString();
      writeJson(lastPaperFile, { id, openedAt: { ...previous?.openedAt, [id]: lastOpened } });
      return { id, lastOpened };
    },
    savePaper(paper) {
      const id = safeId(paper?.id);
      if (!validPaper(paper, id)) throw new Error('Invalid paper workspace.');
      const saved = { ...paper, id, updatedAt: new Date().toISOString() };
      writeJson(paperPath(id), saved);
      const index = readLibraryIndex(libraryIndexFile);
      index.entries[id] = libraryEntryFromPaper(saved, index.entries[id]);
      writeJson(libraryIndexFile, index);
    },
    updateLibraryMetadata({ id, title, tags }) {
      const safe = safeId(id);
      if (typeof title !== 'string' || !title.trim() || !Array.isArray(tags)) throw new Error('Invalid library metadata.');
      const { index } = reconcileLibraryIndex();
      const entry = index.entries[safe];
      if (!entry) throw new Error('Library entry could not be found.');
      entry.libraryTitle = title.trim();
      entry.tags = normalizeLibraryTags(tags);
      writeJson(libraryIndexFile, index);
      return listLibrary();
    },
    clearData() {
      clearPageArchives(root);
      if (fs.existsSync(papersDir)) {
        for (const name of fs.readdirSync(papersDir)) {
          if (/^[a-f0-9]{64}\.json(?:\.backup)?$/.test(name)) fs.unlinkSync(path.join(papersDir, name));
        }
      }
      for (const name of ['settings.json', 'settings.json.backup', 'glossary.json', 'glossary.json.backup', 'updates.json', 'updates.json.backup', 'last-paper.json', 'last-paper.json.backup', 'library-index.json', 'library-index.json.backup']) {
        const file = path.join(root, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      if (fs.existsSync(root)) for (const name of fs.readdirSync(root)) if (/^library-index\.json\.\d+\.tmp$/.test(name)) fs.unlinkSync(path.join(root, name));
    },
    libraryPersistenceWarning() { return libraryPersistenceWarning; },
    list: listLibrary
  };
}

function bootstrapSnapshot(store, version) {
  const library = store.list();
  return { settings: store.settings(), glossary: store.glossary(), library, lastPaperId: store.lastPaperId(),
    libraryPersistenceWarning: store.libraryPersistenceWarning(), version };
}

module.exports = { createStore, defaults, safeId, readJson, writeJson, bootstrapSnapshot };
