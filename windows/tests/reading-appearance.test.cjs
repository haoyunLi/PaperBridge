const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../electron/storage.cjs');
const defaults = require('../electron/reading-appearance.json');
const { normalizeReadingAppearance, readerLineHeight, readingAppearanceControls } = require('../electron/reading-appearance.mjs');

test('new reading appearance matches Mac defaults and control ranges with additive spacing', () => {
  assert.deepEqual(normalizeReadingAppearance(), { fontSize: 16, lineSpacing: 5, lineHeight: null, readingWidth: 920, legacyAppearanceRanges: false });
  assert.deepEqual(readingAppearanceControls(defaults).map(({ key, min, max, step }) => ({ key, min, max, step })), [
    { key: 'fontSize', min: 13, max: 24, step: 1 },
    { key: 'lineSpacing', min: 2, max: 12, step: 1 },
    { key: 'readingWidth', min: 640, max: 1200, step: 1 }
  ]);
  assert.equal(readerLineHeight(defaults), 'calc(1.2em + 5px)');
  assert.equal(readerLineHeight({ ...defaults, fontSize: 24 }), 'calc(1.2em + 5px)', 'added spacing does not scale with font size');
});

test('legacy proportional spacing and outlying published slider choices remain usable', () => {
  const saved = Object.freeze({ fontSize: 25, lineHeight: 2.2, readingWidth: 560 });
  const migrated = normalizeReadingAppearance(saved);
  assert.deepEqual(migrated, { fontSize: 25, lineHeight: 2.2, lineSpacing: null, readingWidth: 560, legacyAppearanceRanges: true });
  assert.equal(readerLineHeight(migrated), 2.2);
  const controls = readingAppearanceControls(migrated);
  assert.equal(controls[0].max, 25);
  assert.equal(controls[1].key, 'lineHeight');
  assert.equal(controls[1].value, 2.2);
  assert.equal(controls[2].min, 560);
  assert.deepEqual(normalizeReadingAppearance({ ...migrated, lineSpacing: 5, lineHeight: null }), {
    fontSize: 25, lineSpacing: 5, lineHeight: null, readingWidth: 560, legacyAppearanceRanges: true
  });
  const moved = normalizeReadingAppearance({ ...migrated, fontSize: 24, readingWidth: 561 });
  assert.equal(readingAppearanceControls(moved)[0].max, 25, 'reducing old font size must retain the way back to 25');
  assert.equal(readingAppearanceControls(moved)[2].min, 560, 'increasing old width must retain the way back to 560');
  assert.deepEqual(normalizeReadingAppearance({ ...migrated, ...defaults }), defaults);
});

test('appearance rejects nonfinite or invalid values without interpreting a legacy multiplier as pixels', () => {
  assert.deepEqual(normalizeReadingAppearance({ fontSize: NaN, readingWidth: -1, lineHeight: Infinity, lineSpacing: null }), defaults);
  assert.equal(normalizeReadingAppearance({ lineSpacing: -10 }).lineSpacing, 2);
  assert.equal(normalizeReadingAppearance({ lineSpacing: 50 }).lineSpacing, 12);
  assert.equal(readerLineHeight({ lineHeight: 1.7 }), 1.7);
  assert.equal(readerLineHeight({ lineSpacing: 5, lineHeight: 1.7 }), 'calc(1.2em + 5px)');
});

test('legacy appearance survives store reload and unrelated save until explicit conversion or reset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-appearance-'));
  try {
    const file = path.join(root, 'settings.json');
    const saved = { fontSize: 25, lineHeight: 1.9, readingWidth: 560, sourceLanguage: 'French' };
    fs.writeFileSync(file, JSON.stringify(saved));
    const store = createStore(root);
    const migrated = store.settings();
    assert.deepEqual(normalizeReadingAppearance(migrated), { fontSize: 25, lineHeight: 1.9, lineSpacing: null, readingWidth: 560, legacyAppearanceRanges: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved, 'reading settings does not rewrite the old file');
    store.saveSettings({ ...migrated, autoCheckUpdates: false });
    const reloaded = createStore(root).settings();
    assert.equal(readerLineHeight(reloaded), 1.9);
    assert.equal(reloaded.fontSize, 25);
    assert.equal(reloaded.readingWidth, 560);
    assert.equal(reloaded.sourceLanguage, 'French');
    assert.equal(reloaded.autoCheckUpdates, false);

    store.saveSettings({ ...reloaded, fontSize: 24, readingWidth: 640, lineSpacing: 7, lineHeight: null });
    const converted = createStore(root).settings();
    assert.equal(readerLineHeight(converted), 'calc(1.2em + 7px)');
    assert.equal(converted.legacyAppearanceRanges, true);
    assert.equal(readingAppearanceControls(converted)[0].max, 25, 'restart and additive conversion keep compatible font limits');
    assert.equal(readingAppearanceControls(converted)[2].min, 560, 'restart and additive conversion keep compatible width limits');
    store.saveSettings({ ...store.settings(), ...defaults });
    assert.deepEqual(normalizeReadingAppearance(createStore(root).settings()), defaults);
    assert.equal(readingAppearanceControls(store.settings())[0].max, 24);
    assert.equal(readingAppearanceControls(store.settings())[2].min, 640);
    assert.equal(store.settings().sourceLanguage, 'French');
    assert.equal(store.settings().autoCheckUpdates, false);
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected appearance test workspace');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('new and partial workspaces receive additive defaults without changing other settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-appearance-new-'));
  try {
    const store = createStore(root);
    assert.deepEqual(normalizeReadingAppearance(store.settings()), defaults);
    store.saveSettings({ translationModel: 'test-local:1b' });
    const loaded = createStore(root).settings();
    assert.deepEqual(normalizeReadingAppearance(loaded), defaults);
    assert.equal(loaded.translationModel, 'test-local:1b');
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected appearance test workspace');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
