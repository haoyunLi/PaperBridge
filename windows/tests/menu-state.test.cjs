const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMenuState, menuCommandState, applyMenuState } = require('../electron/menu-state.cjs');

const readyPaper = { ready: true, hasPaper: true, busy: false, hasSelection: true, canUndo: true, canPrimaryTask: true,
  canGoBack: true, canGoForward: true, canSummarize: true, canFullTranslation: true, canLookupSelection: true, canExport: true, checkingUpdates: false };

test('startup and empty-workspace menus cannot dispatch paper or selection actions', () => {
  assert.equal(Object.values(menuCommandState({})).every(enabled => !enabled), true);
  const empty = menuCommandState({ ...readyPaper, hasPaper: false });
  for (const command of ['export', 'summary', 'find', 'readingBack', 'readingForward', 'primaryTask', 'generateSummary', 'generateFullTranslation', 'undo', 'translateSelection', 'explainSelection', 'highlightSelection']) {
    assert.equal(empty[command], false, `${command} needs a paper`);
  }
  for (const command of ['openPdf', 'library', 'glossary', 'settings', 'setup', 'onboarding', 'checkUpdates']) assert.equal(empty[command], true);
});

test('busy work disables import/export and generation while keeping navigation and annotations available', () => {
  const busy = menuCommandState({ ...readyPaper, busy: true, canLookupSelection: false });
  for (const command of ['openPdf', 'export', 'primaryTask', 'generateSummary', 'generateFullTranslation', 'translateSelection', 'explainSelection']) assert.equal(busy[command], false);
  for (const command of ['summary', 'find', 'highlightSelection', 'undo', 'inspector', 'library']) assert.equal(busy[command], true);
});

test('selection, task availability and update progress each control the corresponding commands', () => {
  const all = menuCommandState(readyPaper);
  assert.equal(Object.values(all).every(Boolean), true);
  const unavailable = menuCommandState({ ...readyPaper, hasSelection: false, canUndo: false, canPrimaryTask: false,
    canGoBack: false, canGoForward: false, canSummarize: false, canFullTranslation: false, canExport: false, checkingUpdates: true });
  for (const command of ['translateSelection', 'explainSelection', 'highlightSelection', 'undo', 'readingBack', 'readingForward', 'primaryTask', 'generateSummary', 'generateFullTranslation', 'export', 'checkUpdates']) assert.equal(unavailable[command], false);
  assert.equal(unavailable.onboarding, true);
});

test('menu IPC data accepts boolean capabilities only and missing fields clear earlier enablement', () => {
  for (const invalid of [null, [], 'ready', { ready: 1 }, { hasPaper: 'false' }, { execute: true }, JSON.parse('{"__proto__":true}')]) {
    assert.throws(() => normalizeMenuState(invalid), /Invalid menu state/);
  }
  const inherited = Object.create({ hasPaper: true }); inherited.ready = true;
  assert.equal(normalizeMenuState(inherited).hasPaper, false);
  assert.equal(normalizeMenuState({ ready: true }).hasSelection, false);
});

test('applying a new snapshot updates existing native menu items without modifying unrelated entries', () => {
  const items = new Map(Object.keys(menuCommandState({})).map(command => [`command:${command}`, { enabled: false }]));
  items.set('quit', { enabled: true });
  const menu = { getMenuItemById: id => items.get(id) };
  applyMenuState(menu, readyPaper);
  assert.equal(items.get('command:export').enabled, true);
  applyMenuState(menu, { ready: true });
  assert.equal(items.get('command:export').enabled, false);
  assert.equal(items.get('command:onboarding').enabled, true);
  assert.equal(items.get('quit').enabled, true);
  assert.doesNotThrow(() => applyMenuState(null, {}));
});
