const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function selectText(page, selector, start, end) {
  await page.evaluate(({ selector, start, end }) => {
    const root = document.querySelector(selector);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode();
    if (!text) throw new Error(`No selectable text in ${selector}`);
    const range = document.createRange();
    range.setStart(text, start); range.setEnd(text, end);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { selector, start, end });
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'heading-parity-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected heading test workspace');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'papers'), { recursive: true });

  let headingAttempts = 0;
  let tagRequests = 0;
  const requests = [];
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') { tagRequests++; return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }] })); }
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body);
      requests.push(payload);
      if (/Explain this whole academic paragraph/i.test(payload.system || '')) {
        return response.end(JSON.stringify({ response: 'This heading introduces the paper summary.', done: true }));
      }
      if ((payload.prompt || '').includes('Abstract')) {
        headingAttempts++;
        if (headingAttempts === 1) return response.end(JSON.stringify({ error: 'Deliberate heading translation failure.' }));
        return response.end(JSON.stringify({ response: '摘要', done: true }));
      }
      return response.end(JSON.stringify({ response: '测试译文', done: true }));
    });
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));

  const id = 'b'.repeat(64);
  const paperFile = path.join(workspace, 'papers', `${id}.json`);
  const blocks = [
    { id: 1, text: 'Abstract', heading: true },
    { id: 2, text: 'Study design', sourceMarkdown: '## Study design', heading: true },
    { id: 3, text: '2 Methods We retained all evidence from both independent reviewers', heading: false },
    { id: 4, text: 'A regular body paragraph remains available for translation.', heading: false },
    ...Array.from({ length: 10 }, (_, index) => ({ id: index + 5, text: `Fixed resource ${index + 5}`, heading: false, resource: true }))
  ].map(block => ({ ...block, translation: '', translationMarkdown: null, status: 'pending', error: '', bookmark: false, highlights: [], translationHighlights: [], notes: [] }));
  fs.writeFileSync(paperFile, JSON.stringify({ id, name: 'Heading parity fixture', type: 'text', blocks,
    sourceMode: 'text', extraction: 'Pasted text', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    position: { tab: 'Reader', block: 1, displayMode: 'bilingual' } }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, translationModel: 'translategemma:4b',
    explainModel: 'translategemma:4b', summaryModel: 'translategemma:4b', quickLookupModel: 'translategemma:4b',
    autoCheckUpdates: false, onboardingCompletedVersion: 1
  }));

  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('heading', { name: 'Heading parity fixture' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    assert.equal(await page.locator('[data-paper-block-id="14"]').count(), 1, 'Paper preview must include blocks beyond the old 12-block cutoff');
    assert.equal(await page.getByRole('button', { name: 'Continue in Reader →', exact: true }).count(), 0);
    await selectText(page, '[data-paper-block-id="14"]', 0, 17);
    await page.getByText('SELECTED TEXT · BLOCK 14', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.teal').click();
    await page.locator('.inspector textarea').fill('Late Paper block remains annotatable.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-1.heading-block').waitFor();
    assert.equal(await page.locator('#block-14 .block-notes').count(), 0, 'Paper notes must not leak into Reader blocks');
    await waitFor(() => tagRequests > 0, 'Ollama model discovery');

    assert.equal(await page.locator('.heading-block').count(), 2);
    assert.equal(await page.locator('#block-3.heading-block').count(), 0, 'heading plus body must remain a body block');
    assert.equal(await page.locator('#block-2 .source-text').innerText(), 'Study design');
    const compact = await page.locator('#block-1').evaluate(node => ({
      background: getComputedStyle(node).backgroundColor,
      topBorder: getComputedStyle(node).borderTopWidth,
      labelDisplay: getComputedStyle(node.querySelector('.block-header>span')).display
    }));
    assert.equal(compact.background, 'rgba(0, 0, 0, 0)');
    assert.equal(compact.topBorder, '0px');
    assert.equal(compact.labelDisplay, 'none');

    await page.locator('#block-1 button[title="Translate heading"]').click();
    await waitFor(() => requests.length > 0, 'heading translation request');
    assert.equal(headingAttempts, 1);
    await page.getByText('Deliberate heading translation failure.', { exact: false }).waitFor();
    assert.equal(await page.locator('#block-1 button[title="Retry heading"]').count(), 1);
    await page.locator('#block-1 button[title="Retry heading"]').click();
    await page.locator('#block-1 .translation-text.done').getByText('摘要', { exact: true }).waitFor();
    assert.match(await page.locator('.reader-top').innerText(), /1 of 4 blocks translated/);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Translation Range', exact: true }).click();
    assert.match(await page.getByRole('button', { name: /^All unfinished blocks/ }).innerText(), /3 blocks/);
    assert.match(await page.getByRole('button', { name: /^Choose section: Study design/ }).innerText(), /3 unfinished blocks/);
    assert.equal(await page.getByRole('button', { name: /^Abstract & Conclusion/ }).isDisabled(), true);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

    await page.getByLabel('Reading mode').selectOption('source');
    assert.equal(await page.locator('#block-1 .source-text').isVisible(), true);
    assert.equal(await page.locator('#block-1 .translation-text').isVisible(), false);
    await page.getByLabel('Reading mode').selectOption('translation');
    assert.equal(await page.locator('#block-1 .source-text').isVisible(), false);
    assert.equal(await page.locator('#block-1 .translation-text').isVisible(), true);
    assert.equal(await page.locator('#block-2 .source-text').isVisible(), true, 'pending heading keeps source visible in translation-only mode');
    await page.getByLabel('Reading mode').selectOption('bilingual');

    await selectText(page, '#block-1 .source-text', 0, 8);
    await page.getByText('SELECTED TEXT · BLOCK 1', { exact: true }).waitFor();
    await page.locator('.inspector button[title="Amber highlight"]').click();
    await page.locator('#block-1 button[title="Bookmark heading"]').click();
    await selectText(page, '#block-1 .translation-text', 0, 2);
    await page.locator('.inspector textarea').fill('Translated heading wording is approved.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await waitFor(() => {
      const saved = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
      return saved.blocks[0].bookmark && saved.blocks[0].highlights?.[0]?.text === 'Abstract'
        && saved.blocks[0].notes?.some(note => note.kind === 'translation' && note.body === 'Translated heading wording is approved.');
    }, 'heading annotations and bookmark');

    const requestCountBeforeExplanation = requests.length;
    await page.locator('#block-1 button[title="Explain heading"]').click();
    await waitFor(() => requests.length > requestCountBeforeExplanation, 'heading explanation request');
    assert.match(requests.at(-1).system, /Explain this whole academic paragraph/i);
    await waitFor(() => Object.values(JSON.parse(fs.readFileSync(paperFile, 'utf8')).paragraphExplanations || {})
      .some(result => result.output === 'This heading introduces the paper summary.'), 'saved heading explanation');
    assert.match(await page.locator('.paragraph-explanation').innerText(), /This heading introduces the paper summary/);
    await page.locator('#block-1 button[title="Edit or split heading"]').click();
    await page.locator('#block-1 .edit-area').getByRole('button', { name: 'Split', exact: true }).waitFor();
    await page.locator('#block-1 .edit-area').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Late Paper block remains annotatable.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Paper' && window.getSelection()?.toString() === 'Fixed resource 14');
    await page.getByLabel('Paper display mode').selectOption('source');
    assert.equal(await page.locator('[data-paper-block-id="1"] [data-paper-kind="source"]').count(), 1);
    assert.equal(await page.locator('[data-paper-block-id="1"] [data-paper-kind="translation"]').count(), 0);
    await page.getByLabel('Paper display mode').selectOption('translation');
    assert.equal(await page.locator('[data-paper-block-id="1"] [data-paper-kind="source"]').count(), 0);
    assert.equal(await page.locator('[data-paper-block-id="1"] [data-paper-kind="translation"]').innerText(), '摘要');
    assert.equal(await page.locator('[data-paper-block-id="2"] [data-paper-kind="source"]').innerText(), 'Study design', 'untranslated Paper blocks retain source context');
    await page.getByLabel('Paper display mode').selectOption('bilingual');
    await selectText(page, '[data-paper-block-id="1"] [data-paper-kind="translation"]', 0, 2);
    await page.locator('.inspector textarea').fill('Paper translation stays separate from Reader.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await waitFor(() => JSON.parse(fs.readFileSync(paperFile, 'utf8')).blocks[0].notes
      .some(note => note.scope === 'paper' && note.kind === 'translation' && note.body === 'Paper translation stays separate from Reader.'), 'Paper translation note');
    await page.getByLabel('Paper display mode').selectOption('source');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Paper translation stays separate from Reader.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Paper display mode"]')?.value === 'bilingual' && window.getSelection()?.toString() === '摘要');
    await page.screenshot({ path: path.join(artifacts, 'paper-bilingual-preview.png') });

    await app.evaluate(({ ipcMain }) => {
      global.__headingExports = [];
      ipcMain.removeHandler('markdown:export');
      ipcMain.handle('markdown:export', (_event, payload) => { global.__headingExports.push(payload); return `${payload.name}.md`; });
    });
    for (const label of ['Translated Markdown', 'Bilingual Markdown']) {
      await page.getByRole('button', { name: 'More ···', exact: true }).click();
      await page.locator('.modal').getByRole('button', { name: 'Export Markdown', exact: true }).click();
      await page.locator('.modal').getByRole('button', { name: label, exact: true }).click();
      await page.locator('.modal').waitFor({ state: 'detached' });
    }
    const exports = await app.evaluate(() => global.__headingExports);
    assert.equal(exports.length, 2);
    assert.match(exports[0].content, /^摘要\n\n\[Untranslated block 2\]/);
    assert.match(exports[1].content, /^Abstract\n\n摘要\n\n## Study design\n\n\*Not translated\*/);
    assert.ok(requests.some(payload => /Explain this whole academic paragraph/i.test(payload.system || '')));
    await page.screenshot({ path: path.join(artifacts, 'heading-parity-reader.png') });
    console.log('Heading parity checks passed: full Paper preview, source/bilingual/translation modes, late-block and translated-side annotations, compact rendering, classification, retry, actions and exports.');
  } finally {
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
