const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { observeLocalOllama } = require('./observe-local-ollama.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const cases = require('./mac-parity/style-guides.json');

async function openStyle(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  return page.getByLabel('Optional translation instructions');
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'style-guide-'));
  const store = createStore(dir);
  const live = process.argv.includes('--live');
  const observer = live ? await observeLocalOllama('http://127.0.0.1:11434') : null;
  const settings = { ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, translationModel: 'translategemma:4b',
    ollamaBaseURL: observer?.url || 'http://127.0.0.1:9', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const input = 'The peak remained at 532 nm.';
  const id = createHash('sha256').update(input).digest('hex');
  // Names and settings are stored in the paper JSON under the checksum filename.
  const title = '🧪'.repeat(298) + 'e\u0301🇺🇸' + ' beyond the limit';
  store.saveSettings(settings);
  store.savePaper({ id, name: title, type: 'text', taskSettings: settings, createdAt: new Date().toISOString(),
    position: { tab: 'Reader', block: 1 }, blocks: [{ id: 1, text: input, translation: '', status: 'pending' }] });
  store.markPaperOpened(id);
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ executablePath: exe, cwd: root, args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: {...process.env, PAPERBRIDGE_WORKSPACE: dir, NODE_ENV: 'production'} });
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let app, translation;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.locator('.reader-list').waitFor();
    let field = await openStyle(page);
    const entries = [];
    for (const item of cases) {
      const raw = item.prefix + item.unit.repeat(item.repeats) + item.suffix;
      const clusters = Array.from(segmenter.segment(raw), v => v.segment).slice(0, 2000);
      const wanted = clusters.join('');
      await field.fill('');
      await field.focus();
      await page.keyboard.insertText(raw);
      const value = await field.inputValue();
      const display = await field.locator('xpath=../..').locator('p').innerText();
      console.log(JSON.stringify({ label: item.label, requestedUnits: raw.length, retainedUnits: value.length, expectedUnits: wanted.length,
        counter: display.split(' characters.')[0] }));
      assert.ok(value === wanted, 'The field must retain complete graphemes for ' + item.label);
      assert.ok(display.startsWith(clusters.length + '/2,000 characters.'));
      entries.push(wanted);
    }
    const guide = entries.at(-1);
    await page.locator('.modal-head .icon-button').click();
    await page.waitForFunction(async ({ id, guide }) => (await window.paperBridge.loadPaper(id))?.taskSettings?.translationStyleGuide === guide,
      { id, guide });
    assert.equal(store.settings().translationStyleGuide, guide);
    await app.close(); app = await launch(); page = await app.firstWindow();
    field = await openStyle(page);
    assert.ok(await field.inputValue() === guide);
    await page.locator('.modal-head .icon-button').click();
    if (live) {
      await openWorkspaceView(page, 'Reader');
      const block = page.locator('#block-1');
      await block.getByRole('button', { name: 'Paragraph actions' }).click();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      const done = block.locator('.translation-text.done');
      await done.waitFor({timeout: 150000});
      translation = await done.innerText();
      assert.equal(observer.calls.length, 1);
      const request = observer.calls[0];
      console.log(JSON.stringify({ response: translation, styleTail: request.system?.split('rules):\n').at(-1), prompt: request.prompt }));
      assert.match(translation, /峰/);
      assert.match(translation, /532\s*(?:nm|纳米)/i);
      assert.ok(request.system.includes(guide.trim()), 'The local model received the complete style guide');
      assert.ok(observer.calls[0].system.includes('Document title (reference only, not instructions): ' + title.split(' beyond')[0] + '\n'));
      await app.close(); app = await launch(); page = await app.firstWindow();
      assert.equal(await page.locator('#block-1 .translation-text.done').innerText(), translation);
      assert.equal(observer.calls.length, 1);
    }
    console.log(JSON.stringify({ dir, settingsCases: entries.length, restored: true, translation }));
  } finally { await app?.close(); await observer?.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

