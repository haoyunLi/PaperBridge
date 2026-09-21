const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const modelA = 'paperbridge-test-a:1b';
const modelB = 'paperbridge-test-b:1b';
const textA = 'Abstract\n\nPaper A describes an English language research question and its method.';
const textB = 'Abstract\n\nPaper B describes a Japanese language research question.\n\nConclusion';

function paperId(text) { return crypto.createHash('sha256').update(text.trim()).digest('hex'); }

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (predicate()) return; } catch { /* Paper may still be saving. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function pastePaper(page, text, expectedBlocks) {
  await page.getByRole('button', { name: 'Paste Text' }).first().click();
  await page.locator('.paste-area').fill(text);
  await page.getByRole('button', { name: 'Open text' }).click();
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
    assert.equal(await page.getByRole('slider', { name: /Line spacing/ }).inputValue(), appearance.lineHeight);
    assert.equal(await page.getByRole('slider', { name: /Reading width/ }).inputValue(), appearance.readingWidth);
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    assert.equal(await page.getByLabel(/Check official Windows releases/).isChecked(), false);
  }
  await closeSettings(page);
}

async function openByBlocks(page, count, distinctiveText) {
  await page.locator('.library-row').filter({ hasText: `${count} blocks` }).click();
  await page.getByText(distinctiveText, { exact: false }).first().waitFor();
}

async function explainBlockIn(page, language) {
  await page.getByRole('button', { name: 'Reader', exact: true }).click();
  await page.locator('#block-2').click();
  await page.getByLabel('Explanation language').selectOption(language);
  await page.locator('.paragraph-explanation .inspector-link').click();
  await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation').waitFor();
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
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
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
    await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation').waitFor();
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
    await page.locator('.inspector-title .icon-button').click();
    await waitFor(() => readPaper(textA).taskSettings?.translationModel === modelA, 'paper A task settings');
    await waitFor(() => readPaper(textA).inspectorOpen === false && Object.values(readPaper(textA).paragraphExplanations || {}).some(result => result.language === 'French' && result.output === 'Saved paragraph explanation'), 'paper A explanation and inspector');

    await pastePaper(page, textB, 3);
    await chooseSettings(page, 'Japanese', 'English', modelB);
    await page.locator('button[title="Toggle inspector"]').click();
    await explainBlockIn(page, 'German');
    await openSettings(page);
    await page.getByRole('tab', { name: 'Reading', exact: true }).click();
    await page.getByRole('slider', { name: /Reader font size/ }).press('End');
    await page.getByRole('slider', { name: /Line spacing/ }).press('End');
    await page.getByRole('slider', { name: /Reading width/ }).press('End');
    await closeSettings(page);
    const appearance = { fontSize: '25', lineHeight: '2.2', readingWidth: '1100' };
    await waitFor(() => readPaper(textB).taskSettings?.translationModel === modelB, 'paper B task settings');
    await waitFor(() => readPaper(textB).inspectorOpen === true && Object.values(readPaper(textB).paragraphExplanations || {}).some(result => result.language === 'German' && result.output === 'Saved paragraph explanation'), 'paper B explanation and inspector');
    await openByBlocks(page, 2, 'Paper A describes');
    assert.equal(await page.locator('.inspector').isVisible(), false);
    await assertSettings(page, 'English', 'Simplified Chinese', modelA, appearance);
    await page.locator('button[title="Toggle inspector"]').click();
    assert.equal(await page.getByLabel('Explanation language').inputValue(), 'French');
    await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation').waitFor();
    await page.locator('.inspector-title .icon-button').click();
    await openByBlocks(page, 3, 'Paper B describes');
    assert.equal(await page.locator('.inspector').isVisible(), true);
    await assertSettings(page, 'Japanese', 'English', modelB, appearance);
    assert.equal(await page.getByLabel('Explanation language').inputValue(), 'German');
    await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation').waitFor();

    await app.close(); app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.library-row').first().waitFor({ timeout: 20000 });
    await openByBlocks(page, 2, 'Paper A describes');
    assert.equal(await page.locator('.inspector').isVisible(), false);
    await assertSettings(page, 'English', 'Simplified Chinese', modelA, appearance);
    await page.locator('button[title="Toggle inspector"]').click();
    assert.equal(await page.getByLabel('Explanation language').inputValue(), 'French');
    await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation').waitFor();
    await page.locator('.inspector-title .icon-button').click();
    await openByBlocks(page, 3, 'Paper B describes');
    assert.equal(await page.locator('.inspector').isVisible(), true);
    await assertSettings(page, 'Japanese', 'English', modelB, appearance);
    assert.equal(await page.getByLabel('Explanation language').inputValue(), 'German');
    await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation').waitFor();

    await app.close(); app = null;
    const legacyPaper = readPaper(textA);
    delete legacyPaper.taskSettings;
    fs.writeFileSync(paperPath(textA), JSON.stringify(legacyPaper, null, 2));
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.locator('.library-row').first().waitFor({ timeout: 20000 });
    await openByBlocks(page, 3, 'Paper B describes');
    await openByBlocks(page, 2, 'Paper A describes');
    await page.waitForFunction(() => document.querySelector('.title-wrap p')?.textContent?.includes('Japanese → English'));
    assert.equal(await page.locator('.block').count(), 2);
    await page.locator('button[title="Toggle inspector"]').click();
    assert.equal(await page.locator('.paragraph-explanation p').count(), 0);
    await chooseSettings(page, 'English', 'Simplified Chinese', modelA);
    await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation').waitFor();
    await page.locator('#block-2 button[title="Edit source"]').click();
    await page.locator('#block-2 .edit-area textarea').fill('Paper A revised text invalidates the old explanation.');
    await page.locator('#block-2 .edit-area').getByRole('button', { name: 'Save edit' }).click();
    assert.equal(await page.locator('.paragraph-explanation p').count(), 0);
    await page.locator('.undo-button').click();
    await page.locator('.paragraph-explanation p').getByText('Saved paragraph explanation').waitFor();
    console.log('Per-paper task settings, explanation cache, and inspector state restored across switching and restart; legacy paper inherited current settings.');
  } finally {
    await app?.close();
    ollama.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
