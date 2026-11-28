const fs = require('node:fs');
const path = require('node:path');
const { trimLibraryText } = require('./library-metadata.mjs');
const readingAppearanceDefaults = require('./reading-appearance.json');
const { normalizeReadingAppearance } = require('./reading-appearance.mjs');
const { clearSavedMineruResults } = require('./mineru-resources.cjs');
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
  autoDownloadUpdates: false,
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

function fileRevision(fd) {
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || !stat.ino) return null;
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  } catch { return null; }
}

const renameRetryClock = new Int32Array(new SharedArrayBuffer(4));
function replaceJsonFile(staged, target) {
  // Windows readers can briefly deny FILE_SHARE_DELETE. Retry the same atomic
  // rename so the previous complete file stays readable throughout the save.
  const delays = [10, 20, 40, 80, 120];
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(staged, target); return; }
    catch (error) {
      if (process.platform !== 'win32' || attempt === delays.length ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      Atomics.wait(renameRetryClock, 0, 0, delays[attempt]);
    }
  }
}

function writeJson(file, value, { validBackup, captureRevision = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    if (fs.existsSync(file)) {
      try {
        const prior = fs.readFileSync(file);
        const parsed = JSON.parse(prior);
        if (!validBackup || validBackup(parsed)) {
          const backup = `${file}.backup`;
          const pending = `${backup}.${process.pid}.tmp`;
          fs.writeFileSync(pending, prior);
          replaceJsonFile(pending, backup);
        }
      } catch { /* retain older backup */ }
    }
    replaceJsonFile(temporary, file);
    // Stat our own handle so a concurrent replacement cannot stamp a different paper.
    return captureRevision ? fileRevision(fd) : null;
  } finally { fs.closeSync(fd); }
}

const LIBRARY_INDEX_VERSION = 1;

function validPaper(value, id) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.id === id &&
    Array.isArray(value.blocks) && value.blocks.every(block => block && typeof block === 'object' && !Array.isArray(block))
    ? value : null;
}

function readPaperRecord(file, id, indexedRevision) {
  for (const candidate of [file, `${file}.backup`]) {
    let fd;
    try {
      fd = fs.openSync(candidate, 'r');
      // Backups are validated on use. A repaired primary must regain precedence.
      const revision = candidate === file ? fileRevision(fd) : null;
      if (revision && revision === indexedRevision) return { revision };
      const paper = validPaper(JSON.parse(fs.readFileSync(fd, 'utf8')), id);
      if (paper) return { paper, revision };
    } catch { /* try backup */ }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return null;
}

function normalizeLibraryTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter(value => typeof value === 'string').map(trimLibraryText).filter(Boolean))].slice(0, 20);
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

function libraryEntryFromPaper(paper, existing, revision) {
  const blocks = Array.isArray(paper.blocks) ? paper.blocks : [];
  const documentName = typeof paper.name === 'string' && paper.name ? paper.name : existing?.documentName || 'Untitled paper';
  return {
    id: paper.id,
    paperRevision: revision,
    documentName,
    libraryTitle: existing ? existing.libraryTitle : typeof paper.libraryTitle === 'string' ? trimLibraryText(paper.libraryTitle) : '',
    tags: existing ? existing.tags : normalizeLibraryTags(paper.tags),
    createdAt: typeof paper.createdAt === 'string' ? paper.createdAt : existing?.createdAt || '',
    updatedAt: typeof paper.updatedAt === 'string' ? paper.updatedAt : existing?.updatedAt || '',
    type: typeof paper.type === 'string' ? paper.type : existing?.type || '',
    blockCount: blocks.length,
    translatedCount: blocks.filter(block => block && block.status === 'ok').length
  };
}

function removeArchivedPdfs(directory) {
  let archivedPdfsRemoved = 0;
  try {
    const location = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!location) return { archivedPdfsRemoved };
    if (!location.isDirectory()) throw new Error('The PDF archive is not a local directory.');
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      const archived = /^[a-f0-9]{64}\.pdf$/.test(item.name);
      const interrupted = /^[a-f0-9]{64}\.pdf\.\d+\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tmp$/.test(item.name);
      if (!archived && !interrupted) continue;
      fs.unlinkSync(path.join(directory, item.name));
      if (archived) archivedPdfsRemoved++;
    }
    return { archivedPdfsRemoved };
  } catch (cause) {
    // Workspace removal has committed. Allow a later clear to retry the remaining files.
    return { archivedPdfsRemoved, pdfCleanupError: cause.message };
  }
}

function createStore(root) {
  const papersDir = path.join(root, 'papers');
  const pdfDir = path.join(root, 'pdfs');
  const lastPaperFile = path.join(root, 'last-paper.json');
  const libraryIndexFile = path.join(root, 'library-index.json');
  let libraryPersistenceWarning = '';
  const paperPath = id => path.join(papersDir, `${safeId(id)}.json`);
  const pdfPath = id => path.join(pdfDir, `${safeId(id)}.pdf`);
  const writeIndex = index => writeJson(libraryIndexFile, index, { validBackup: normalizeLibraryIndex });
  const reconcileLibraryIndex = ({ tolerateWriteFailure = false } = {}) => {
    const index = readLibraryIndex(libraryIndexFile);
    const available = new Set();
    const files = fs.existsSync(papersDir) ? fs.readdirSync(papersDir) : [];
    const ids = new Set(files.map(name => name.match(/^([a-f0-9]{64})\.json(?:\.backup)?$/)?.[1]).filter(Boolean));
    let changed = false;
    for (const id of ids) {
      const entry = index.entries[id];
      const record = readPaperRecord(paperPath(id), id, entry?.paperRevision);
      if (!record) continue;
      available.add(id);
      if (!record.paper) continue;
      const next = libraryEntryFromPaper(record.paper, entry, record.revision);
      if (JSON.stringify(index.entries[id]) !== JSON.stringify(next)) { index.entries[id] = next; changed = true; }
    }
    if (changed) {
      try { writeIndex(index); }
      catch (error) {
        if (!tolerateWriteFailure) throw error;
        libraryPersistenceWarning = 'Library labels and metadata were not persisted. Fix the storage issue, then retry.';
      }
    }
    return { index, available };
  };
  const librarySnapshot = () => {
    libraryPersistenceWarning = '';
    const { index, available } = reconcileLibraryIndex({ tolerateWriteFailure: true });
    const recent = readJson(lastPaperFile, {});
    const library = Object.values(index.entries).map(entry => {
      const opened = recent?.openedAt?.[entry.id];
      return { id: entry.id, name: entry.libraryTitle || entry.documentName, tags: [...entry.tags], createdAt: entry.createdAt,
        updatedAt: entry.updatedAt, type: entry.type, lastOpened: typeof opened === 'string' ? opened : null,
        blockCount: entry.blockCount, translatedCount: entry.translatedCount, workspaceAvailable: available.has(entry.id) };
    }).sort((a, b) => Number(b.id === recent?.id) - Number(a.id === recent?.id)
      || (b.lastOpened || b.createdAt || b.updatedAt || '').localeCompare(a.lastOpened || a.createdAt || a.updatedAt || ''));
    return { library, lastPaperId: available.has(recent?.id) ? recent.id : null };
  };
  const availableRecord = id => readPaperRecord(paperPath(id), id, readLibraryIndex(libraryIndexFile).entries[id]?.paperRevision);
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
    saveUpdateCheckAt(value) { this.saveUpdateCheckState({ lastCheckAt: value }); },
    updateCheckState() { return readJson(path.join(root, 'updates.json'), {}); },
    saveUpdateCheckState(value) {
      const { skippedTag } = this.updateCheckState() || {};
      writeJson(path.join(root, 'updates.json'), { ...(skippedTag && { skippedTag }), ...value });
    },
    skipUpdate(tag) {
      writeJson(path.join(root, 'updates.json'), { ...this.updateCheckState(), skippedTag: tag });
    },
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
      const paper = readPaperRecord(paperPath(safe), safe)?.paper;
      if (!paper) return null;
      const entry = readLibraryIndex(libraryIndexFile).entries[safe];
      return entry ? { ...paper, libraryTitle: entry.libraryTitle, tags: [...entry.tags] } : paper;
    },
    lastPaperId() {
      const id = readJson(lastPaperFile, {})?.id;
      try { return availableRecord(id) ? id : null; }
      catch { return null; }
    },
    markPaperOpened(id) {
      safeId(id);
      if (!availableRecord(id)) throw new Error('Paper could not be loaded.');
      const previous = readJson(lastPaperFile, {});
      const lastOpened = new Date().toISOString();
      writeJson(lastPaperFile, { id, openedAt: { ...previous?.openedAt, [id]: lastOpened } });
      return { id, lastOpened };
    },
    savePaper(paper, onPaperWritten) {
      const id = safeId(paper?.id);
      if (!validPaper(paper, id)) throw new Error('Invalid paper workspace.');
      const saved = { ...paper, id, updatedAt: new Date().toISOString() };
      const revision = writeJson(paperPath(id), saved, { validBackup: value => validPaper(value, id), captureRevision: true });
      onPaperWritten?.();
      const index = readLibraryIndex(libraryIndexFile);
      index.entries[id] = libraryEntryFromPaper(saved, index.entries[id], revision);
      writeIndex(index);
    },
    updateLibraryMetadata({ id, title, tags }) {
      const safe = safeId(id);
      if (typeof title !== 'string' || !trimLibraryText(title) || !Array.isArray(tags)) throw new Error('Invalid library metadata.');
      const { index } = reconcileLibraryIndex();
      const entry = index.entries[safe];
      if (!entry) throw new Error('Library entry could not be found.');
      entry.libraryTitle = trimLibraryText(title);
      entry.tags = normalizeLibraryTags(tags);
      writeIndex(index);
      return librarySnapshot().library;
    },
    clearData(includeArchivedPdfs = false) {
      clearPageArchives(root);
      clearSavedMineruResults(root);
      const savedFiles = [
        [papersDir, /^[a-f0-9]{64}\.json(?:\.backup)?(?:\.\d+\.tmp)?$/],
        [root, /^(?:settings|glossary|updates|last-paper|library-index)\.json(?:\.backup)?(?:\.\d+\.tmp)?$/]
      ];
      for (const [dir, pattern] of savedFiles) {
        if (!fs.existsSync(dir)) continue;
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!item.isDirectory() && pattern.test(item.name)) fs.unlinkSync(path.join(dir, item.name));
        }
      }
      return includeArchivedPdfs === true ? removeArchivedPdfs(pdfDir) : { archivedPdfsRemoved: 0 };
    },
    libraryPersistenceWarning() { return libraryPersistenceWarning; },
    librarySnapshot,
    list: () => librarySnapshot().library
  };
}

function bootstrapSnapshot(store, version) {
  const { library, lastPaperId } = store.librarySnapshot();
  return { settings: store.settings(), glossary: store.glossary(), library, lastPaperId,
    libraryPersistenceWarning: store.libraryPersistenceWarning(), version };
}

module.exports = { createStore, defaults, safeId, readJson, writeJson, bootstrapSnapshot };
