const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const model = 'paperbridge-reader-review:1b';
const translated = '原位机制促进翻译质量，并检查准确的术语边界。';
const resultA = 'EXPLANATION_FOR_ALPHA_MUST_NOT_APPEAR_FOR_BETA';
const resultB = 'Explication française du contrôle bêta.';
const longContext = ' Additional background describes the study design, measurement procedure, data interpretation, and carefully stated research limitations.'.repeat(24);

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* The app may still be saving. */ }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function selectText(page, selector, quote) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate(({ selector, quote }) => {
    const host = document.querySelector(selector);
    const text = host?.textContent || '';
    const offset = text.indexOf(quote);
    if (offset < 0 || offset !== text.lastIndexOf(quote)) throw new Error(`Selection fixture is not unique: ${quote}`);
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let cursor = 0;
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const end = cursor + node.textContent.length;
      if (!started && offset < end) { range.setStart(node, offset - cursor); started = true; }
      if (started && offset + quote.length <= end) { range.setEnd(node, offset + quote.length - cursor); break; }
      cursor = end;
    }
    const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { selector, quote });
  await page.waitForFunction(value => document.querySelector('.inspector blockquote')?.textContent === value, quote);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'reader-review-workspace');
  if (!path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep)) throw new Error('Unexpected test workspace path');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'papers'), { recursive: true });

  const requests = [];
  let heldA;
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        const payload = JSON.parse(body);
        requests.push(payload);
        const reply = output => { if (!response.destroyed) response.end(JSON.stringify({ response: output, done: true })); };
        if (payload.prompt.includes('Selected text:\nAlpha mechanism\n')) {
          heldA = { payload, release: () => reply(resultA) };
        } else if (payload.prompt.includes('Selected text:\nBeta control\n')) reply(resultB);
        else reply(translated);
      } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error.message })); }
    });
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const settings = {
    ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`,
    translationModel: model, summaryModel: model, explainModel: model, quickLookupModel: model,
    sourceLanguage: 'English', targetLanguage: 'Simplified Chinese',
    autoCheckUpdates: false, onboardingCompletedVersion: 1, pdfExtractionMode: 'pdfOnly', maxParagraphChars: 10000
  };
  const id = crypto.createHash('sha256').update('PaperBridge reader review regression fixture').digest('hex');
  const document = {
    id, name: 'Reader review fixture', type: 'text', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    taskSettings: settings, explanationLanguage: 'English', inspectorOpen: true, extraction: 'Pasted text',
    position: { block: 2, tab: 'Reader', displayMode: 'bilingual' },
    blocks: [
      { text: 'Abstract', heading: true },
      { text: `Alpha mechanism improves translation quality and checks exact term boundaries.${longContext}` },
      { text: 'Methods', heading: true },
      { text: `Beta control measures repeatability across local language model runs.${longContext}` },
      { text: 'Conclusion', heading: true },
      { text: 'Gamma result preserves every local research annotation and completed translation.' }
    ].map((block, index) => ({ id: index + 1, translation: '', status: 'pending', ...block }))
  };
  const paperPath = path.join(workspace, 'papers', `${id}.json`);
  const glossaryPath = path.join(workspace, 'glossary.json');
  const readPaper = () => JSON.parse(fs.readFileSync(paperPath, 'utf8'));
  const readTerms = () => JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(paperPath, JSON.stringify(document));

  let app;
  let page;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 900 });
    await page.locator('#block-2').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.title-wrap p')?.textContent.includes('English → Simplified Chinese'));

    // A bookmark undo must not restore a whole-paper snapshot from before AI work.
    await page.locator('#block-2 button[title="Bookmark"]').click();
    await page.locator('#block-2 button.bookmarked').waitFor();
    await page.locator('#block-2 button[title="Translate or retry block"]').click();
    await page.locator('#block-2 .translation-text.done').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('#block-2 .translation-text.done').innerText(), translated);
    await page.locator('.undo-button').click();
    assert.equal(await page.locator('#block-2 button.bookmarked').count(), 0);
    assert.equal(await page.locator('#block-2 .translation-text.done').innerText(), translated);
    await waitFor(() => {
      const saved = readPaper().blocks[1];
      return !saved.bookmark && saved.status === 'ok' && saved.translation === translated;
    }, 'bookmark undo and retained translation to persist');

    // Directory navigation must clear a filter that would otherwise hide its target.
    await page.locator('.search').fill('Alpha mechanism');
    await page.waitForFunction(() => document.querySelectorAll('.reader-list .block').length === 1);
    await page.locator('.sidebar .outline-row').filter({ hasText: 'Methods' }).click();
    await page.waitForFunction(() => document.querySelector('.search')?.value === '' && document.querySelectorAll('.reader-list .block').length === 6);
    assert.equal(await page.locator('#block-3').isVisible(), true);

    // A delayed lookup of A must never be shown under a newly selected passage B.
    await page.locator('#block-2 .source-text').click();
    await page.getByLabel('Explanation language').selectOption('French');
    await page.evaluate(() => {
      window.__readerReviewWrongResults = [];
      window.__readerReviewObserver = new MutationObserver(() => {
        const selected = document.querySelector('.inspector blockquote')?.textContent;
        const result = document.querySelector('.inspector-result.explain')?.textContent || '';
        if (selected === 'Beta control' && result.includes('EXPLANATION_FOR_ALPHA')) window.__readerReviewWrongResults.push(result);
      });
      window.__readerReviewObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await selectText(page, '#block-2 .source-text', 'Alpha mechanism');
    await page.locator('.action-grid').getByRole('button', { name: 'Explain', exact: true }).click();
    await waitFor(() => heldA, 'delayed Alpha explanation request');
    assert.match(heldA.payload.prompt, /Explain the selected academic text in French\./);
    await selectText(page, '#block-4 .source-text', 'Beta control');
    await page.locator('.task-progress').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.inspector-result.explain').count(), 0);
    heldA.release();
    await page.locator('.action-grid').getByRole('button', { name: 'Explain', exact: true }).click();
    await page.locator('.inspector-result.explain p').getByText(resultB, { exact: true }).waitFor({ timeout: 15000 });
    const betaRequest = requests.find(item => item.prompt.includes('Selected text:\nBeta control\n'));
    assert.ok(betaRequest, 'Beta must receive its own explanation request');
    assert.match(betaRequest.prompt, /Explain the selected academic text in French\./);
    assert.deepEqual(await page.evaluate(() => window.__readerReviewWrongResults), []);
    assert.equal(await page.locator('.inspector-result.explain p').innerText(), resultB);

    // A term saved from the translated column uses the reverse language pair.
    await selectText(page, '#block-2 .translation-text', '原位机制');
    await page.getByPlaceholder('Approved translation').fill('in situ mechanism');
    await page.getByRole('button', { name: 'Save term', exact: true }).click();
    await waitFor(() => readTerms().length === 1 && readTerms()[0].target === 'in situ mechanism', 'first reverse-direction term');
    assert.deepEqual(readTerms()[0], { source: '原位机制', target: 'in situ mechanism', sourceLanguage: 'Simplified Chinese', targetLanguage: 'English' });
    await page.getByPlaceholder('Approved translation').fill('spatial mechanism');
    await page.getByRole('button', { name: 'Save term', exact: true }).click();
    await waitFor(() => readTerms().length === 1 && readTerms()[0].target === 'spatial mechanism', 'replacement of the same reverse-direction term');
    await page.getByRole('button', { name: 'Saved Terminology', exact: true }).click();
    await page.getByRole('heading', { name: 'Saved Terminology', exact: true }).waitFor();
    assert.equal(await page.locator('.term-row').count(), 1);
    assert.match(await page.locator('.term-row').innerText(), /Simplified Chinese → English/);
    assert.match(await page.locator('.term-row').innerText(), /spatial mechanism/);
    await page.locator('.modal-head .icon-button').click();

    // Scrolling alone must update the section used by the translation range menu.
    const scrollToBlock = async blockId => {
      await page.evaluate(id => {
        const host = document.querySelector('.main-scroll');
        const block = document.querySelector(`#block-${id}`);
        host.scrollTo({ top: host.scrollTop + block.getBoundingClientRect().top - host.getBoundingClientRect().top + 20, behavior: 'instant' });
      }, blockId);
      await waitFor(() => readPaper().position?.block === blockId, `scroll position for block ${blockId}`);
    };
    const assertCurrentSection = async title => {
      await page.getByRole('button', { name: 'More ···', exact: true }).click();
      await page.getByRole('button', { name: 'Translation Range', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`^Current section: ${title}`) }).waitFor();
      await page.locator('.modal-head .icon-button').click();
    };
    await page.keyboard.press('Escape');
    await scrollToBlock(2);
    await assertCurrentSection('Abstract');
    await scrollToBlock(4);
    await assertCurrentSection('Methods');

    // Highlight-only reading records and bookmarks must survive both export routes.
    await page.locator('#block-4 button[title="Bookmark"]').click();
    await selectText(page, '#block-4 .source-text', 'Beta control');
    await page.locator('.inspector button[title="Amber"]').click();
    await waitFor(() => {
      const saved = readPaper();
      return saved.blocks[3].bookmark && saved.blocks[3].highlights?.some(item => item.text === 'Beta control');
    }, 'highlight-only reading record');
    assert.equal(readPaper().blocks.reduce((count, block) => count + (block.notes?.length || 0), 0), 0);
    await app.evaluate(({ ipcMain }) => {
      global.__readerReviewExports = [];
      ipcMain.removeHandler('markdown:export');
      ipcMain.handle('markdown:export', (_event, payload) => {
        global.__readerReviewExports.push(payload);
        return `${payload.name}.md`;
      });
    });
    for (const label of ['Summary, sources and notes', 'Bilingual Markdown']) {
      await page.getByRole('button', { name: 'More ···', exact: true }).click();
      await page.locator('.modal').getByRole('button', { name: 'Export Markdown', exact: true }).click();
      await page.locator('.modal').getByRole('button', { name: label, exact: true }).click();
      await page.locator('.modal').waitFor({ state: 'detached' });
    }
    const exports = await app.evaluate(() => global.__readerReviewExports);
    assert.equal(exports.length, 2);
    assert.ok(exports[0].name.endsWith('-analysis'));
    assert.ok(exports[1].name.endsWith('-bilingual'));
    for (const exported of exports) {
      assert.match(exported.content, /## Bookmarks\n\n- Block 4: Beta control/);
      assert.match(exported.content, /## Highlights\n\n### Reader · Block 4 · source · amber\n\n> Beta control/);
      assert.match(exported.content, /## Notes\n\nNone saved\./);
    }
    fs.writeFileSync(path.join(artifacts, 'reader-review-exports.json'), JSON.stringify(exports, null, 2));
    await page.screenshot({ path: path.join(artifacts, 'reader-review.png') });
    console.log('Reader regression checks passed: undo retains AI output; outline clears search; selection results stay with their source and use French; translated-side terminology reverses direction and replaces duplicates; current section follows scrolling; Analysis and bilingual exports include highlight-only records and bookmarks.');
  } catch (error) {
    await page?.screenshot({ path: path.join(artifacts, 'reader-review-failure.png') }).catch(() => {});
    throw error;
  } finally {
    heldA?.release();
    fs.writeFileSync(path.join(artifacts, 'reader-review-requests.json'), JSON.stringify(requests, null, 2));
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
