const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

const root = path.resolve(__dirname, '..');
const name = 'mixed-cid-record.pdf';
const fixture = path.join(__dirname, 'mac-parity', name);
const paperBytes = fs.readFileSync(fixture);
const id = createHash('sha256').update(paperBytes).digest('hex');
const note = 'Verify the final reference against the original notebook.';
const control = 'The reference signal remained constant.';
const chinese = require('./mac-parity/cjk-calibration.json')[0];
const pages = [['Opening calibration record', 'The reference film was held at 293 K.'],
  [chinese.title, chinese.source, chinese.control], ['Final control record', control]];

function launch(executablePath, dir) {
  return electron.launch({ cwd: root, executablePath, args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
}

async function translate(page, block) {
  await block.getByRole('button', { name: 'Paragraph actions' }).click();
  await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
  const output = block.locator('.translation-text.done');
  await output.waitFor({ timeout: 150000 });
  return output.innerText();
}

async function prepareOld(dir, settings) {
  const store = createStore(dir);
  const oldExe = process.env.PAPERBRIDGE_TEST_OLD_EXECUTABLE;
  if (oldExe) {
    const app = await launch(oldExe, dir);
    try {
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 1440, height: 900 });
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture);
      await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
      await page.getByRole('heading', { name, exact: true }).waitFor();
      await openWorkspaceView(page, 'Reader');
      const block = page.locator('#block-4');
      await block.getByRole('button', { name: 'Bookmark', exact: true }).click();
      const output = await translate(page, block);
      assert.match(output, /[\u3400-\u9fff]/);
      const show = page.getByRole('button', { name: 'Show Research Inspector' });
      if (await show.isVisible()) await show.click();
      await block.locator('.source-text').evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
      await page.getByPlaceholder('What should you remember?').fill(note);
      await page.waitForFunction(async ({id, note}) => (await window.paperBridge.loadPaper(id))?.blocks[3].notes?.some(n => n.body === note), {id, note});
    } finally { await app.close(); }
  } else {
    fs.mkdirSync(path.dirname(store.pdfPath(id)), { recursive: true });
    fs.writeFileSync(store.pdfPath(id), paperBytes);
    const blocks = pages.flatMap((lines, i) => i === 1 ? [] : lines.map(text => ({ page: i + 1, text })))
      .map((block, i) => ({ ...block, id: i + 1, translation: '', status: 'pending' }));
    const last = { ...blocks[3], translation: '参考信号保持恒定。', status: 'ok', bookmark: true,
      notes: [{ id: 'lab-note', kind: 'source', text: control, offset: 0, body: note }] };
    store.savePaper({ id, name, type: 'pdf', sourceMode: 'pdf', extraction: 'PDF.js', blocks: [...blocks.slice(0, 3), last],
      pdfBlocks: blocks, taskSettings: settings, position: { tab: 'Reader', block: 4, page: 3 } });
    store.markPaperOpened(id);
  }
  const old = store.paper(id);
  assert.deepEqual(old.blocks.map(b => b.page), [1, 1, 3, 3]);
  assert.ok(!old.pdfTextVersion && old.blocks[3].bookmark && old.blocks[3].notes.some(n => n.body === note));
  return old;
}

async function run() {
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'mixed-cid-'));
  const settings = { ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly',
    sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', translationModel: 'translategemma:4b' };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  const old = await prepareOld(dir, settings);
  const store = createStore(dir);
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const reference = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE)).mixedCalibration;
  if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
    assert.equal(reference.sha256, id);
    assert.deepEqual(reference.pages.map(text => text.split('\n')), pages);
  }
  let app = await launch(exe, dir);
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => { throw new Error('Recovery must use the archived copy'); }; });
    const recover = page.getByRole('button', { name: 'Recover PDF text in new copy' });
    for (const tab of ['Original', 'Paper']) {
      await openWorkspaceView(page, tab);
      if (tab === 'Paper') await page.getByLabel('Paper display mode').selectOption('source');
      await page.locator('.pdf-toolbar').waitFor();
      const host = page.locator('.pdf-continuous');
      await host.focus();
      await host.press('Control+Home');
      await page.locator('.pdf-toolbar').getByText('Exact original PDF · page 1 of 3').waitFor();
      await page.locator('.textLayer[data-page="1"]').waitFor();
      assert.equal(await recover.count(), 0);
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await recover.waitFor();
      assert.ok((await page.locator('.textLayer[data-page="2"]').textContent()).includes('532'));
    }
    await page.locator('.save-status.saved').waitFor();
    const originalBlocks = store.paper(id).blocks;
    for (const [i, block] of old.blocks.entries()) {
      for (const field of ['text', 'translation', 'bookmark', 'notes', 'highlights']) {
        assert.deepEqual(originalBlocks[i][field], block[field], 'Restoring an older workspace must preserve ' + field);
      }
    }
    const archive = store.pdfPath(id);
    fs.renameSync(archive, archive + '.held');
    try {
      await recover.click();
      await page.getByText(/The archived PDF is missing/).first().waitFor();
      assert.deepEqual(store.paper(id).blocks, originalBlocks);
      assert.equal(fs.readdirSync(path.join(dir, 'papers')).filter(file => file.endsWith('.json')).length, 1);
    } finally { fs.renameSync(archive + '.held', archive); }
    await recover.click();
    const copyName = name + ' (new extraction)';
    await page.getByRole('heading', { name: copyName, exact: true }).waitFor();
    await page.locator('.reader-list .source-text').filter({ hasText: chinese.source }).waitFor();
    const copyId = await page.locator('.main-scroll').getAttribute('data-reading-paper-id');
    assert.notEqual(copyId, id);
    await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id))?.blocks.length === 7, copyId);
    const copy = store.paper(copyId);
    assert.equal(copy.sourceMode, 'pdf');
    assert.equal(copy.position.tab, 'Reader');
    assert.equal(copy.selectedParagraphID, copy.blocks.find(b => b.page === 2).id);
    assert.deepEqual(copy.blocks.map(b => b.text), pages.flat());
    assert.deepEqual(fs.readFileSync(store.pdfPath(copyId)), paperBytes);
    assert.deepEqual(store.paper(id).blocks, originalBlocks);
    let recoveredTranslation;
    if (process.env.PAPERBRIDGE_TEST_OLD_EXECUTABLE) {
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Reading', exact: true }).click();
      const panel = page.locator('.settings-panel');
      await panel.getByLabel('Source language').selectOption('Simplified Chinese');
      await panel.getByLabel('Target language').selectOption('English');
      await page.locator('.modal-head .icon-button').click();
      const recoveredBlock = page.locator('.reader-list .block').filter({ hasText: chinese.control });
      recoveredTranslation = await translate(page, recoveredBlock);
      assert.match(recoveredTranslation, /three|\b3\b/i);
      assert.match(recoveredTranslation, /(?:not|no |unchanged|constant|same|stable|fixed|stationary)/i);
      assert.match(recoveredTranslation, /peak/i);
    }
    await app.close();
    app = await launch(exe, dir);
    page = await app.firstWindow();
    await page.getByRole('heading', { name: copyName, exact: true }).waitFor();
    await page.locator('.reader-list .source-text').filter({ hasText: chinese.source }).waitFor();
    if (recoveredTranslation) {
      const saved = page.locator('.reader-list .block').filter({ hasText: chinese.control });
      assert.equal(await saved.locator('.translation-text.done').innerText(), recoveredTranslation);
    }
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Paper Library', exact: true }).click();
    const oldRow = page.locator('.modal-list-row').filter({ has: page.getByText(name, { exact: true }) });
    await oldRow.click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await openWorkspaceView(page, 'Reader');
    const last = page.locator('#block-4');
    assert.equal(await last.getByRole('button', { name: 'Bookmark', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await last.locator('.translation-text.done').innerText(), old.blocks[3].translation);
    await last.locator('.block-notes').getByText(note, { exact: false }).waitFor();
    console.log(JSON.stringify({ dir, oldParagraphs: old.blocks.length, restoredParagraphs: copy.blocks.length,
      selectedRecoveredPage: 2, recoveredTranslation, originalTranslation: old.blocks[3].translation, savedNote: note,
      oldExecutable: Boolean(process.env.PAPERBRIDGE_TEST_OLD_EXECUTABLE), native: Boolean(reference) }));
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
