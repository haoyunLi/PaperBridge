const fs = require('node:fs');
const path = require('node:path');
const readingAppearanceDefaults = require('./reading-appearance.json');
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

function createStore(root) {
  const papersDir = path.join(root, 'papers');
  const pdfDir = path.join(root, 'pdfs');
  const lastPaperFile = path.join(root, 'last-paper.json');
  const paperPath = id => path.join(papersDir, `${safeId(id)}.json`);
  const pdfPath = id => path.join(pdfDir, `${safeId(id)}.pdf`);
  return {
    root,
    pdfPath,
    settings() {
      const saved = readJson(path.join(root, 'settings.json'), {});
      const { apiKey, openAIAPIKey, openAIConsent, isOpenAIOptInConfirmed, ...safe } = saved && typeof saved === 'object' ? saved : {};
      return { ...defaults, ...safe, aiProvider: safe.aiProvider === 'openai' ? 'openai' : 'ollama', translationStyleGuide: String(safe.translationStyleGuide || '').slice(0, 2000) };
    },
    saveSettings(settings) {
      const { apiKey, openAIAPIKey, openAIConsent, isOpenAIOptInConfirmed, ...safe } = settings && typeof settings === 'object' ? settings : {};
      writeJson(path.join(root, 'settings.json'), { ...defaults, ...safe, aiProvider: safe.aiProvider === 'openai' ? 'openai' : 'ollama', translationStyleGuide: String(safe.translationStyleGuide || '').slice(0, 2000) });
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
    paper(id) { return readJson(paperPath(id), null); },
    lastPaperId() {
      const id = readJson(lastPaperFile, {})?.id;
      try { return readJson(paperPath(id), null) ? id : null; }
      catch { return null; }
    },
    markPaperOpened(id) {
      safeId(id);
      if (!readJson(paperPath(id), null)) throw new Error('Paper could not be loaded.');
      const previous = readJson(lastPaperFile, {});
      const lastOpened = new Date().toISOString();
      writeJson(lastPaperFile, { id, openedAt: { ...previous?.openedAt, [id]: lastOpened } });
      return { id, lastOpened };
    },
    savePaper(paper) {
      safeId(paper.id);
      writeJson(paperPath(paper.id), { ...paper, updatedAt: new Date().toISOString() });
    },
    clearData() {
      clearPageArchives(root);
      if (fs.existsSync(papersDir)) {
        for (const name of fs.readdirSync(papersDir)) {
          if (/^[a-f0-9]{64}\.json(?:\.backup)?$/.test(name)) fs.unlinkSync(path.join(papersDir, name));
        }
      }
      for (const name of ['settings.json', 'settings.json.backup', 'glossary.json', 'glossary.json.backup', 'updates.json', 'updates.json.backup', 'last-paper.json', 'last-paper.json.backup']) {
        const file = path.join(root, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    },
    list() {
      if (!fs.existsSync(papersDir)) return [];
      const recent = readJson(lastPaperFile, {});
      return fs.readdirSync(papersDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
        .map(name => readJson(path.join(papersDir, name), null)).filter(Boolean)
        .map(({ id, name, libraryTitle, tags, createdAt, updatedAt, blocks, type }) => {
          const opened = recent?.openedAt?.[id];
          return { id, name: libraryTitle || name, tags: tags || [], createdAt, updatedAt, type, lastOpened: typeof opened === 'string' ? opened : null,
            blockCount: blocks?.length || 0, translatedCount: blocks?.filter(block => block?.status === 'ok').length || 0 };
        })
        .sort((a, b) => Number(b.id === recent?.id) - Number(a.id === recent?.id)
          || (b.lastOpened || b.createdAt || b.updatedAt || '').localeCompare(a.lastOpened || a.createdAt || a.updatedAt || ''));
    }
  };
}

function bootstrapSnapshot(store, version) {
  return { settings: store.settings(), glossary: store.glossary(), library: store.list(), lastPaperId: store.lastPaperId(), version };
}

module.exports = { createStore, defaults, safeId, readJson, writeJson, bootstrapSnapshot };
