const fs = require('node:fs');
const path = require('node:path');

const defaults = {
  ollamaBaseURL: 'http://localhost:11434',
  translationModel: 'translategemma:4b',
  summaryModel: 'translategemma:4b',
  explainModel: 'translategemma:4b',
  sourceLanguage: 'English',
  targetLanguage: 'Simplified Chinese',
  maxParagraphChars: 1800,
  fontSize: 17,
  lineHeight: 1.7,
  readingWidth: 860,
  mineruExecutable: ''
  ,mineruBackend: 'auto'
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
  const paperPath = id => path.join(papersDir, `${safeId(id)}.json`);
  const pdfPath = id => path.join(pdfDir, `${safeId(id)}.pdf`);
  return {
    root,
    pdfPath,
    settings() { return { ...defaults, ...readJson(path.join(root, 'settings.json'), {}) }; },
    saveSettings(settings) { writeJson(path.join(root, 'settings.json'), { ...defaults, ...settings }); },
    glossary() { return readJson(path.join(root, 'glossary.json'), []); },
    saveGlossary(glossary) { writeJson(path.join(root, 'glossary.json'), glossary.slice(0, 500)); },
    paper(id) { return readJson(paperPath(id), null); },
    savePaper(paper) {
      safeId(paper.id);
      writeJson(paperPath(paper.id), { ...paper, updatedAt: new Date().toISOString() });
    },
    list() {
      if (!fs.existsSync(papersDir)) return [];
      return fs.readdirSync(papersDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
        .map(name => readJson(path.join(papersDir, name), null)).filter(Boolean)
        .map(({ id, name, tags, createdAt, updatedAt, blocks, type }) => ({ id, name, tags: tags || [], createdAt, updatedAt, type, blockCount: blocks?.length || 0 }))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    }
  };
}

module.exports = { createStore, defaults, safeId, readJson, writeJson };
