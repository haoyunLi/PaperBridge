const { revealSidebarSource, openPasteText, loadPastedText, openWorkspaceView } = require('./sidebar-controls.cjs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const appearanceDefaults = require('../electron/reading-appearance.json');

const modelA = 'paperbridge-test-a:1b';
const modelB = 'paperbridge-test-b:1b';
const textA = 'Abstract\n\nPaper A describes an English language research question and its method.';
const textB = 'Abstract\n\nPaper B describes a Japanese language research question.\n\nConclusion';

function paperId(text) { return crypto.createHash('sha256').update(text.trim()).digest('hex'); }

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* Paper may still be saving. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function pastePaper(page, text, expectedBlocks) {
  await revealSidebarSource(page);
  await openPasteText(page);
  await page.locator('.paste-area').fill(text);
  await loadPastedText(page, { view: 'Paper' });
  await page.locator('.paper-preview-block').first().waitFor();
  await page.waitForFunction(count => document.querySelectorAll('.paper-preview-block').length === count, expectedBlocks);
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
}

async function closeSettings(page) { await page.locator('.modal-head .icon-button').click(); }

async function chooseSettings(page, source, target, model) {
  await openSettings(page);
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  await page.getByLabel('Source language').selectOption(source);
  await page.getByLabel('Target language').selectOption(target);
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  for (const label of ['Translation model', 'Summary model', 'Explanation model', 'Quick lookup model']) {
    await page.getByLabel(label).selectOption(model);
  }
  await closeSettings(page);
  await page.waitForFunction(([from, to]) => document.querySelector('.title-wrap p')?.textContent?.includes(`${from} → ${to}`), [source, target]);
}

async function assertSettings(page, source, target, model, appearance) {
  await page.waitForFunction(([from, to]) => document.querySelector('.title-wrap p')?.textContent?.includes(`${from} → ${to}`), [source, target]);
  await openSettings(page);
  await page.getByRole('tab', { name: 'Reading', exact: true }).click();
  assert.equal(await page.getByLabel('Source language').inputValue(), source);
  assert.equal(await page.getByLabel('Target language').inputValue(), target);
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  for (const label of ['Translation model', 'Summary model', 'Explanation model', 'Quick lookup model']) {
    assert.equal(await page.getByLabel(label).inputValue(), model);
  }
  if (appearance) {
    await page.getByRole('tab', { name: 'Reading', exact: true }).click();
    assert.equal(await page.getByRole('slider', { name: /Reader font size/ }).inputValue(), appearance.fontSize);
    assert.equal(await page.getByRole('slider', { name: /Line spacing/ }).inputValue(), appearance.lineSpacing ?? appearance.lineHeight);
    assert.equal(await page.getByRole('slider', { name: /Reading width/ }).inputValue(), appearance.readingWidth);
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    assert.equal(await page.getByLabel(/Check official Windows releases/).isChecked(), false);
  }
  await closeSettings(page);
}

async function waitForPaper(page, id, distinctiveText) {
  // The inline paste draft can contain the destination text while the old
  // paper is still waiting for its load IPC. Check identity and layout first.
  await page.waitForFunction(id => {
    const host = document.querySelector('.main-scroll');
    return host?.dataset.readingPaperId === id && host.getAttribute('aria-busy') === 'false';
  }, id, { timeout: 15000 });
  await page.locator('.main-scroll').locator('.source-text, .paper-preview-source')
    .filter({ hasText: distinctiveText }).first().waitFor({ state: 'visible' });
}

async function openByBlocks(page, count, id, distinctiveText) {
  await page.locator('.library-row').filter({ hasText: `${count} blocks` }).click();
  await waitForPaper(page, id, distinctiveText);
}

async function waitForSavedExplanation(page) {
  // Locator actions re-resolve after React replaces a paper/inspector subtree;
  // cached element handles and separate scroll calls can race that replacement.
  await page.locator('#block-2').click();
  await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation', { exact: true }).waitFor({ state: 'visible' });
}

async function explainBlockIn(page, language) {
  await openWorkspaceView(page, 'Reader');
  await page.locator('#block-2').click();
  await page.getByLabel('Explanation language').selectOption(language);
  await page.locator('.paragraph-explanation .inspector-link').click();
  await waitForSavedExplanation(page);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'paper-settings-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected test workspace path');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });

  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: modelA }, { model: modelB }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url === '/api/generate') return response.end(JSON.stringify({ response: 'Saved paragraph explanation', done: true }));
    response.statusCode = 404; response.end('{}');
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, autoCheckUpdates: false, onboardingCompletedVersion: 1 }));

  const paperPath = text => path.join(workspace, 'papers', `${paperId(text)}.json`);
  const readPaper = text => JSON.parse(fs.readFileSync(paperPath(text), 'utf8'));
  const launch = () => electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let app, page;
  try {
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.waitForSelector('.welcome', { timeout: 20000 });

    await pastePaper(page, textA, 2);
    await chooseSettings(page, 'English', 'Simplified Chinese', modelA);
    await explainBlockIn(page, 'French');
    await page.getByRole('button', { name: 'Translate Paper', exact: true }).click();
    await waitFor(() => readPaper(textA).blocks[1]?.status === 'ok', 'paper A translation');
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached' });
    await chooseSettings(page, 'Japanese', 'English', modelB);
    assert.equal(await page.locator('.paragraph-explanation p').count(), 0);
    await waitFor(() => readPaper(textA).blocks[1]?.status === 'pending', 'different settings do not reuse old translation');
    await chooseSettings(page, 'English', 'Simplified Chinese', modelA);
    await waitForSavedExplanation(page);
    await waitFor(() => readPaper(textA).blocks[1]?.status === 'ok', 'original task settings restore translation');
    await openSettings(page);
    await page.getByRole('tab', { name: 'Reading', exact: true }).click();
    const chunkSlider = page.getByRole('slider', { name: /Maximum translation chunk/ });
    const originalChunk = Number(await chunkSlider.inputValue());
    await chunkSlider.press('ArrowRight');
    await waitFor(() => readPaper(textA).taskSettings.maxParagraphChars === originalChunk + 100 && readPaper(textA).blocks[1].status === 'pending', 'chunk slider changes only the paragraph output variant');
    await chunkSlider.press('ArrowLeft');
    await waitFor(() => readPaper(textA).taskSettings.maxParagraphChars === originalChunk && readPaper(textA).blocks[1].status === 'ok', 'restoring chunk size recovers the completed paragraph');
    await closeSettings(page);
    await page.getByRole('button', { name: /Close inspector drawer|Hide inspector/ }).click();
    await waitFor(() => readPaper(textA).taskSettings?.translationModel === modelA, 'paper A task settings');
    await waitFor(() => readPaper(textA).inspectorOpen === false && Object.values(readPaper(textA).paragraphExplanations || {}).some(result => result.language === 'French' && result.output === 'Saved paragraph explanation'), 'paper A explanation and inspector');

    await pastePaper(page, textB, 3);
    await chooseSettings(page, 'Japanese', 'English', modelB);
    await page.locator('button[title="Toggle inspector"]').click();
    await explainBlockIn(page, 'German');
    await page.setViewportSize({ width: 980, height: 620 });
    const appearanceButton = () => page.getByRole('button', { name: 'Reading Appearance', exact: true });
    const appearancePopover = () => page.getByRole('dialog', { name: 'Reading Appearance', exact: true });
    const fontSlider = () => appearancePopover().getByRole('slider', { name: 'Reader font size', exact: true });
    await appearanceButton().press('Enter');
    await appearancePopover().waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Reader font size');
    const triggerBounds = await appearanceButton().boundingBox();
    const panelBounds = await appearancePopover().boundingBox();
    assert.ok(panelBounds.x >= 0 && panelBounds.y >= triggerBounds.y + triggerBounds.height);
    assert.ok(panelBounds.x + panelBounds.width <= 980 && panelBounds.y + panelBounds.height <= 620);
    assert.ok(Math.abs(panelBounds.x + panelBounds.width - triggerBounds.x - triggerBounds.width) < 2, 'The popover should align to its toolbar button');
    await fontSlider().press('End');
    await appearancePopover().getByRole('slider', { name: 'Line spacing', exact: true }).press('End');
    await appearancePopover().getByRole('slider', { name: 'Reading width', exact: true }).press('End');
    await page.waitForFunction(() => {
      const passage = document.querySelector('#block-2 .source-text');
      const style = passage && getComputedStyle(passage);
      return style?.fontSize === '24px' && style.lineHeight === '40.8px' && getComputedStyle(document.querySelector('.reader-list')).maxWidth === '1200px';
    });
    await page.keyboard.press('Escape');
    await appearancePopover().waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Reading Appearance');
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.getByRole('button', { name: 'Focus Reading', exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector('.reader-list').getBoundingClientRect().width - 1200) < 1);
    const readerWidth = await page.locator('.reader-list').evaluate(list => ({
      outer: list.getBoundingClientRect().width,
      card: list.querySelector('#block-2').getBoundingClientRect().width,
      left: parseFloat(getComputedStyle(list).paddingLeft), right: parseFloat(getComputedStyle(list).paddingRight)
    }));
    assert.deepEqual(readerWidth, { outer: 1200, card: 1156, left: 22, right: 22 }, 'reading width includes the macOS 22px padding on both sides');
    await openWorkspaceView(page, 'Paper');
    await page.waitForFunction(() => Math.abs(document.querySelector('.document-preview').getBoundingClientRect().width - 1200) < 1);
    await openWorkspaceView(page, 'Reader');
    await page.getByRole('button', { name: 'Exit Focus Reading', exact: true }).click();
    await page.setViewportSize({ width: 980, height: 620 });
    await appearanceButton().click();
    await appearancePopover().waitFor();
    await page.locator('.title-wrap h1').click();
    await appearancePopover().waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1320, height: 820 });
    const appearance = { fontSize: '24', lineSpacing: '12', readingWidth: '1200' };
    await waitFor(() => readPaper(textB).taskSettings?.translationModel === modelB, 'paper B task settings');
    await waitFor(() => readPaper(textB).inspectorOpen === true && Object.values(readPaper(textB).paragraphExplanations || {}).some(result => result.language === 'German' && result.output === 'Saved paragraph explanation'), 'paper B explanation and inspector');
    await openByBlocks(page, 2, paperId(textA), 'Paper A describes');
    assert.equal(await page.locator('.inspector').isVisible(), false);
    await assertSettings(page, 'English', 'Simplified Chinese', modelA, appearance);
    await page.locator('button[title="Toggle inspector"]').click();
    assert.equal(await page.getByLabel('Explanation language').inputValue(), 'French');
    await waitForSavedExplanation(page);
    await page.getByRole('button', { name: /Close inspector drawer|Hide inspector/ }).click();
    // Hold the real destination response to reproduce the CI race: B's text
    // already matches the retained paste draft, but A is still displayed.
    await app.evaluate(({ ipcMain }, destinationId) => {
      const original = ipcMain._invokeHandlers.get('paper:load');
      if (!original) throw new Error('Missing production paper:load handler');
      const state = globalThis.__paperSettingsHeldLoad = { original, used: false, release: null };
      ipcMain.removeHandler('paper:load');
      ipcMain.handle('paper:load', async (event, id) => {
        const snapshot = await original(event, id);
        if (id !== destinationId || state.used) return snapshot;
        state.used = true;
        return new Promise(resolve => { state.release = () => resolve(snapshot); });
      });
    }, paperId(textB));
    let reopeningFinished = false;
    const reopening = openByBlocks(page, 3, paperId(textB), 'Paper B describes').then(
      () => { reopeningFinished = true; return null; },
      error => { reopeningFinished = true; return error; }
    );
    try {
      await waitFor(() => app.evaluate(() => typeof globalThis.__paperSettingsHeldLoad?.release === 'function'), 'held paper B load');
      const legacyMatch = page.getByText('Paper B describes', { exact: false }).first();
      await legacyMatch.waitFor({ state: 'visible', timeout: 3000 });
      assert.equal(await legacyMatch.evaluate(node => node.tagName), 'TEXTAREA', 'the old page-wide wait already matches the retained paste draft');
      assert.equal(await page.locator('.paste-area').inputValue(), textB);
      assert.equal(await page.locator('.main-scroll').getAttribute('data-reading-paper-id'), paperId(textA));
      assert.equal(await page.locator('.main-scroll .source-text').filter({ hasText: 'Paper A describes' }).isVisible(), true);
      assert.equal(await page.locator('.inspector').isVisible(), false, 'paper A remains visible until the held paper B load finishes');
      assert.equal(reopeningFinished, false, 'the corrected helper must not resolve from the paste draft');
    } finally {
      await app.evaluate(({ ipcMain }) => {
        const state = globalThis.__paperSettingsHeldLoad;
        ipcMain.removeHandler('paper:load');
        ipcMain.handle('paper:load', state.original);
        state.release?.();
        delete globalThis.__paperSettingsHeldLoad;
      });
    }
    const reopeningError = await reopening;
    if (reopeningError) throw reopeningError;
    assert.equal(await page.locator('.inspector').isVisible(), true);
    await assertSettings(page, 'Japanese', 'English', modelB, appearance);
    assert.equal(await page.getByLabel('Explanation language').inputValue(), 'German');
    await waitForSavedExplanation(page);

    await page.getByRole('button', { name: 'Focus Reading', exact: true }).click();
    await page.keyboard.press('Control+Shift+l');
    const library = page.getByRole('dialog', { name: 'Paper Library', exact: true });
    await library.getByRole('button', { name: /\b\d+\/2 translated\b/ }).click();
    await library.waitFor({ state: 'hidden' });
    await waitForPaper(page, paperId(textA), 'Paper A describes');
    await page.getByRole('button', { name: 'Exit Focus Reading', exact: true }).click();
    assert.equal(await page.locator('.sidebar').isVisible(), true);
    assert.equal(await page.locator('.inspector').isVisible(), false, 'Exiting focus on another paper must use its own saved inspector setting');

    await app.close(); app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.library-row').first().waitFor({ timeout: 20000 });
    await openByBlocks(page, 2, paperId(textA), 'Paper A describes');
    assert.equal(await page.locator('.inspector').isVisible(), false);
    await assertSettings(page, 'English', 'Simplified Chinese', modelA, appearance);
    await page.locator('button[title="Toggle inspector"]').click();
    assert.equal(await page.getByLabel('Explanation language').inputValue(), 'French');
    await waitForSavedExplanation(page);
    await page.getByRole('button', { name: /Close inspector drawer|Hide inspector/ }).click();
    await openByBlocks(page, 3, paperId(textB), 'Paper B describes');
    assert.equal(await page.locator('.inspector').isVisible(), true);
    await assertSettings(page, 'Japanese', 'English', modelB, appearance);
    assert.equal(await page.getByLabel('Explanation language').inputValue(), 'German');
    await waitForSavedExplanation(page);

    await app.close(); app = null;
    const legacyPaper = readPaper(textA);
    delete legacyPaper.taskSettings;
    fs.writeFileSync(paperPath(textA), JSON.stringify(legacyPaper, null, 2));
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.library-row').first().waitFor({ timeout: 20000 });
    await openByBlocks(page, 3, paperId(textB), 'Paper B describes');
    await openByBlocks(page, 2, paperId(textA), 'Paper A describes');
    await page.waitForFunction(() => document.querySelector('.title-wrap p')?.textContent?.includes('Japanese → English'));
    assert.equal(await page.locator('.block').count(), 2);
    await page.locator('button[title="Toggle inspector"]').click();
    assert.equal(await page.locator('.paragraph-explanation p').count(), 0);
    await chooseSettings(page, 'English', 'Simplified Chinese', modelA);
    await waitForSavedExplanation(page);
    await page.locator('#block-2').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
    await page.getByRole('dialog', { name: 'Repair Paragraph 2', exact: true }).getByRole('textbox', { name: 'Paragraph source' }).fill('Paper A revised text invalidates the old explanation.');
    await page.getByRole('dialog', { name: 'Repair Paragraph 2', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal(await page.locator('.paragraph-explanation p').count(), 0);
    await page.locator('.undo-button').click();
    await waitForSavedExplanation(page);

    const original = readPaper(textA).blocks[1];
    assert.equal(original.status, 'ok');
    await page.locator('#block-2 button[title="Bookmark"]').click();
    await page.locator('#block-2').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Repair Paragraph 2', exact: true });
    await editor.locator('textarea').fill(`${original.text}\n\nA new paragraph with a\nmanual line break.`);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('#block-3 .source-text').getByText('A new paragraph with a manual line break.', { exact: true }).waitFor();
    await waitFor(() => readPaper(textA).blocks.slice(1).length === 2 && readPaper(textA).blocks.slice(1).every(block => block.bookmark && block.status === 'pending'), 'separate saved paragraphs and bookmarks');
    await page.locator('.undo-button').click();
    await waitFor(() => readPaper(textA).blocks.length === 2 && readPaper(textA).blocks[1].translation === original.translation && readPaper(textA).blocks[1].bookmark, 'undo restores the original bookmarked translation');

    for (const tab of ['Overview', 'Full Translation', 'Paper', 'Reader']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await appearanceButton().click();
      await appearancePopover().waitFor();
      assert.equal(await fontSlider().inputValue(), '24');
    }
    await appearancePopover().getByRole('button', { name: 'Reset Appearance', exact: true }).click();
    await page.keyboard.press('Escape');
    await appearancePopover().waitFor({ state: 'hidden' });
    await assertSettings(page, 'English', 'Simplified Chinese', modelA, Object.fromEntries(Object.entries(appearanceDefaults).map(([key, value]) => [key, String(value)])));
    assert.equal(readPaper(textA).blocks[1].translation, original.translation);

    // An existing 0.2 workspace must keep its proportional spacing until the
    // reader explicitly chooses the new additive spacing or resets appearance.
    const settingsPath = path.join(workspace, 'settings.json');
    const readSettings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const expectAppearance = async (size, line, width) => page.waitForFunction(({ size, line, width }) => {
      const passage = document.querySelector('#block-2 .source-text');
      const style = passage && getComputedStyle(passage);
      return style?.fontSize === size && style.lineHeight === line &&
        getComputedStyle(document.querySelector('.reader-list')).maxWidth === width;
    }, { size, line, width });
    const restartInReader = async () => {
      await app.close(); app = null;
      app = await launch();
      page = await app.firstWindow();
      await page.setViewportSize({ width: 1320, height: 820 });
      await page.locator('#block-2 .source-text').waitFor({ timeout: 20000 });
    };
    await app.close(); app = null;
    const legacySettings = { ...readSettings(), fontSize: 25, lineHeight: 1.9, readingWidth: 560, pdfExtractionMode: 'mineruPreferred' };
    delete legacySettings.lineSpacing;
    delete legacySettings.legacyAppearanceRanges;
    fs.writeFileSync(settingsPath, JSON.stringify(legacySettings));
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('#block-2 .source-text').waitFor({ timeout: 20000 });
    await expectAppearance('25px', '47.5px', '560px');
    await appearanceButton().click();
    const widthSlider = () => appearancePopover().getByRole('slider', { name: 'Reading width', exact: true });
    await fontSlider().press('ArrowLeft');
    assert.equal(await fontSlider().inputValue(), '24');
    await fontSlider().press('ArrowRight');
    assert.equal(await fontSlider().inputValue(), '25', 'the legacy font maximum remains reachable');
    await widthSlider().press('ArrowRight');
    assert.equal(await widthSlider().inputValue(), '561');
    await widthSlider().press('ArrowLeft');
    assert.equal(await widthSlider().inputValue(), '560', 'the legacy width minimum remains reachable');
    await page.keyboard.press('Escape');
    await openSettings(page);
    await page.getByRole('tab', { name: 'Parsing', exact: true }).click();
    await page.getByLabel('PDF extraction mode').selectOption('pdfOnly');
    await page.getByRole('tab', { name: 'Reading', exact: true }).click();
    assert.equal(await page.getByRole('slider', { name: 'Line spacing', exact: true }).inputValue(), '1.9');
    assert.equal(await page.getByRole('button', { name: 'Use extra spacing', exact: true }).isVisible(), true);
    await closeSettings(page);
    await waitFor(() => readSettings().pdfExtractionMode === 'pdfOnly' && readSettings().lineSpacing === null && readSettings().lineHeight === 1.9 && readSettings().legacyAppearanceRanges === true, 'unrelated settings save preserves legacy spacing and ranges');
    await restartInReader();
    await expectAppearance('25px', '47.5px', '560px');

    await appearanceButton().click();
    await appearancePopover().getByRole('button', { name: 'Use extra spacing', exact: true }).click();
    const spacingSlider = () => appearancePopover().getByRole('slider', { name: 'Line spacing', exact: true });
    assert.equal(await spacingSlider().inputValue(), '5');
    assert.equal(await spacingSlider().getAttribute('aria-valuetext'), '5 extra pixels');
    await spacingSlider().press('ArrowRight');
    await page.keyboard.press('Escape');
    await expectAppearance('25px', '36px', '560px');
    await waitFor(() => readSettings().lineSpacing === 6 && readSettings().lineHeight === null, 'explicit additive spacing persisted');
    await appearanceButton().click();
    await fontSlider().press('ArrowLeft');
    await widthSlider().press('End');
    await page.keyboard.press('Escape');
    await expectAppearance('24px', '34.8px', '1200px');
    await waitFor(() => readSettings().fontSize === 24 && readSettings().readingWidth === 1200, 'legacy range marker survives values inside standard bounds');
    await restartInReader();
    await expectAppearance('24px', '34.8px', '1200px');
    await appearanceButton().click();
    assert.equal(await fontSlider().getAttribute('max'), '25');
    assert.equal(await widthSlider().getAttribute('min'), '560');
    await fontSlider().press('End');
    await widthSlider().press('Home');
    await expectAppearance('25px', '36px', '560px');
    assert.equal(await appearancePopover().getByRole('button', { name: 'Use extra spacing', exact: true }).count(), 0);
    await appearancePopover().getByRole('button', { name: 'Reset Appearance', exact: true }).click();
    await page.keyboard.press('Escape');
    await expectAppearance('16px', '24.2px', '920px');
    await waitFor(() => readSettings().fontSize === 16 && readSettings().lineSpacing === 5 && readSettings().lineHeight === null && readSettings().readingWidth === 920 && readSettings().legacyAppearanceRanges === false, 'new appearance reset persisted');
    await restartInReader();
    await expectAppearance('16px', '24.2px', '920px');
    await appearanceButton().click();
    assert.equal(await fontSlider().getAttribute('max'), '24');
    assert.equal(await widthSlider().getAttribute('min'), '640');
    await page.keyboard.press('Escape');
    assert.equal(readSettings().pdfExtractionMode, 'pdfOnly');
    assert.equal(readPaper(textA).blocks[1].translation, original.translation);

    console.log('Paper task settings and explanations restored after destination load despite a matching paste draft; additive appearance persists globally, legacy proportional spacing survives unrelated saves and restart, and explicit conversion/reset preserve paper work.');
  } catch (error) {
    if (page && !page.isClosed()) {
      const snapshot = await page.locator('body').evaluate(() => {
        const main = document.querySelector('.main-scroll');
        const inspector = document.querySelector('.inspector');
        return { paperId: main?.dataset.readingPaperId, layoutBusy: main?.getAttribute('aria-busy'),
          tab: document.querySelector('.tabs button.active')?.textContent,
          title: document.querySelector('.title-wrap h1')?.textContent,
          subtitle: document.querySelector('.title-wrap p')?.textContent,
          selectedLibrary: document.querySelector('.library-row.selected')?.textContent,
          mainText: main?.textContent?.slice(0, 1000), pasteDraft: document.querySelector('.paste-area')?.value,
          inspector: inspector ? { display: getComputedStyle(inspector).display, rects: inspector.getClientRects().length } : null };
      }, null, { timeout: 5000 }).catch(cause => ({ diagnosticError: cause.message }));
      fs.writeFileSync(path.join(workspace, 'failure-diagnostics.json'), JSON.stringify({ error: error.stack, snapshot }, null, 2));
      await page.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 5000 }).catch(() => {});
    }
    throw error;
  } finally {
    await app?.close();
    ollama.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
