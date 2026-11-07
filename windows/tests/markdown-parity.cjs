const assert = require('node:assert/strict');
const { revealSidebarSource } = require('./sidebar-controls.cjs');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');
const { clickTextOffset } = require('./reading-caret.cjs');
const { readMineruMarkdown } = require('../electron/mineru-output.cjs');

async function selectFormula(paragraph) {
  await paragraph.locator('.katex-html').waitFor();
  return paragraph.evaluate(node => {
    const math = node.querySelector('.katex');
    const start = math.previousSibling;
    const end = math.nextSibling;
    const range = document.createRange();
    range.setStart(start, start.length - 'stack of '.length);
    range.setEnd(end, ' identical layers'.length);
    const selected = window.getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return 'stack of ' + math.querySelector('.katex-html').textContent + ' identical layers';
  });
}

async function waitForNoteUnderline(page, selector, quote) {
  await page.waitForFunction(({ selector, quote }) => [...(CSS.highlights.get('paperbridge-note') || [])].some(range => {
    if (!range.startContainer.parentElement?.closest(selector)) return false;
    const fragment = range.cloneContents();
    fragment.querySelectorAll('.katex-mathml, [data-selection-ignore]').forEach(node => node.remove());
    return fragment.textContent === quote;
  }), { selector, quote });
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'markdown-parity-workspace');
  if (!path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep)) throw new Error('Unexpected workspace path');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'papers'), { recursive: true });
  const id = 'a'.repeat(64);
  const figure = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';
  const formula = 'A stack of $N = 6$ identical layers.';
  const translated = '阿什什<sup>∗</sup>报告了一个测量结果。 ' + formula;
  const resourceDirectory = path.join(workspace, 'mineru', id, 'paper', 'auto');
  fs.mkdirSync(path.join(resourceDirectory, 'images'), { recursive: true });
  fs.mkdirSync(path.join(resourceDirectory, 'data'), { recursive: true });
  const figureBytes = Buffer.from(figure.split(',')[1], 'base64');
  fs.writeFileSync(path.join(resourceDirectory, 'images', 'table cell.png'), figureBytes);
  const measurements = 'trial,score\n1,42\n';
  fs.writeFileSync(path.join(resourceDirectory, 'data', 'measurements.csv'), measurements);
  const output = path.join(resourceDirectory, 'paper.md');
  fs.writeFileSync(output, [
    '# Research title',
    'Ashish Vaswani<sup>∗</sup> reported a measured result. ' + formula,
    '<table><thead><tr><th>Method</th><th>Score</th></tr></thead><tbody><tr><td>Attention</td><td>42<img src="images/table%20cell.png" alt="Table panel"></td></tr></tbody></table>',
    `![Figure](${figure})`,
    'Unsafe <img src="javascript:alert(1)" onerror="window.__paperbridgeUnsafe=true"><script>window.__paperbridgeUnsafe=true</script> text.',
    'A paragraph whose previous translation failed.',
    'Repeat repeat repeat.',
    '## References',
    '[1] Reference entry remains in the original language. [Measurements](data/measurements.csv#rows) [Missing appendix](data/missing.csv)'
  ].join('\n\n'));
  const parts = readMineruMarkdown(output).split('\n\n');
  const blocks = parts.map((sourceMarkdown, index) => ({
    id: index + 1, sourceMarkdown, text: sourceMarkdown.replace('$N = 6$', '[Formula]'), heading: index === 0,
    resource: index === 2 || index === 3, status: index === 1 ? 'ok' : index === 5 ? 'failed' : 'pending',
    translation: index === 1 ? translated.replace('$N = 6$', '[Formula]') : '',
    translationMarkdown: index === 1 ? translated : null,
    error: index === 5 ? 'Local model stopped.' : '', highlights: [], translationHighlights: [],
    notes: index === 5 ? [{ id: 'stale-note', text: 'Missing citation', offset: 0, kind: 'source', body: 'Retain this stale note.' }] : []
  }));
  fs.writeFileSync(path.join(workspace, 'papers', `${id}.json`), JSON.stringify({
    id, name: 'Markdown parity fixture', type: 'text', blocks,
    taskSettings: { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' },
    mineruMarkdown: parts.join('\n\n'), sourceMode: 'mineru', extraction: 'MinerU',
    summary: { source: formula + '\n\nSecond stack.', target: formula, sourceLanguage: 'English', targetLanguage: 'Chinese' },
    viewNotes: [{ id: 'shifted-summary', scope: 'summarySource', text: 'stack', offset: null,
      renderedAnchor: { offset: 2, before: 'A ', after: ' was here' }, body: 'A changed summary annotation' },
    { id: 'moved-summary', scope: 'summarySource', text: 'identical layers', offset: null,
      renderedAnchor: { offset: 0, before: '', after: ' was here' }, body: 'A moved summary phrase' }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    position: { tab: 'Paper', block: 1, displayMode: 'bilingual' }
  }));
  const requests = [];
  let failOnce = true;
  const model = 'translategemma:4b';
  const ollama = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    const input = JSON.parse(await new Promise(resolve => {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => resolve(body));
    })).prompt;
    requests.push(input);
    if (failOnce && input.includes('previous translation failed')) {
      failOnce = false;
      response.statusCode = 503;
      return response.end('{}');
    }
    const markdown = input.split('Markdown block:\n').at(-1)
      .replace('Research title', '研究标题').replace('A paragraph whose previous translation failed.', '已恢复的段落译文。');
    response.end(JSON.stringify({ response: markdown, done: true }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    fontSize: 21, lineHeight: 1.9, readingWidth: 700, autoCheckUpdates: false, onboardingCompletedVersion: 1,
    ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`
  }));
  const launch = () => electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('heading', { name: 'Markdown parity fixture' }).waitFor();
    assert.equal(await page.locator('.document-preview [data-paper-kind="source"] sup').count(), 1);
    assert.equal(await page.locator('.document-preview [data-paper-kind="translation"] sup').count(), 1);
    assert.equal(await page.locator('.document-preview table td').allInnerTexts().then(cells => cells.join(',')), 'Attention,42');
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.document-preview img[src^="data:image/png"]')];
      return images.length === 2 && images.every(image => image.naturalWidth === 1);
    });
    assert.equal(await page.locator('.document-preview script').count(), 0);
    assert.equal(await page.locator('.document-preview [onerror]').count(), 0);
    assert.equal(await page.evaluate(() => window.__paperbridgeUnsafe), undefined);
    const paperStyle = await page.locator('.document-preview').evaluate(node => ({ size: getComputedStyle(node).fontSize, line: getComputedStyle(node).lineHeight, width: node.getBoundingClientRect().width }));
    assert.equal(paperStyle.size, '21px');
    assert.ok(paperStyle.width <= 701);
    assert.ok(Number.parseFloat(paperStyle.line) > 35);
    const paperFormula = page.locator('[data-paper-block-id="2"] [data-paper-kind="source"] p');
    const formulaQuote = 'stack of ' + await paperFormula.locator('.katex-html').textContent() + ' identical layers';
    await clickTextOffset(page, paperFormula, (await paperFormula.textContent()).indexOf('stack of '));
    for (let index = 0; index < formulaQuote.length + 2; index++) {
      await page.keyboard.press('Shift+ArrowRight');
      if (await page.locator('.inspector blockquote').textContent() === formulaQuote) break;
    }
    assert.match(formulaQuote, /^stack of N\s*=\s*6 identical layers$/);
    assert.equal(await page.locator('.inspector blockquote').innerText(), formulaQuote);
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill('Paper formula selection');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-coral')?.size), 1);
    await waitForNoteUnderline(page, '[data-paper-block-id="2"] [data-paper-kind="source"]', formulaQuote);
    await page.waitForFunction(async paperId => (await window.paperBridge.loadPaper(paperId))?.blocks[1].notes.some(item => item.body === 'Paper formula selection'), id);
    const formulaSaved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8')).blocks[1];
    for (const item of [...formulaSaved.notes, ...formulaSaved.highlights]) {
      assert.equal(item.text, formulaQuote);
      assert.equal(item.offset, null);
      assert.equal(item.renderedAnchor.offset, item.displayOffset);
      assert.equal(item.renderedSource, undefined);
      assert.equal(item.renderedText, undefined);
    }
    await clickTextOffset(page, page.locator('[data-paper-block-id="7"] [data-paper-kind="source"] p'), 14);
    for (let index = 0; index < 6; index++) await page.keyboard.press('Shift+ArrowRight');
    await page.getByText('SELECTED TEXT · BLOCK 7', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.teal').click();
    await page.locator('.inspector textarea').fill('The third occurrence belongs to block seven.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-teal')?.size), 1);
    assert.equal(await page.evaluate(() => [...(CSS.highlights.get('paperbridge-note') || [])]
      .find(range => range.startContainer.parentElement.closest('[data-paper-block-id="7"]'))?.startOffset), 14);
    const previewSaved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
    assert.deepEqual(previewSaved.blocks[6].highlights.map(item => ({ scope: item.scope, text: item.text, offset: item.offset })), [{ scope: 'paper', text: 'repeat', offset: 14 }]);
    assert.equal(previewSaved.blocks[6].notes[0].offset, 14);
    assert.equal(previewSaved.blocks[6].notes[0].scope, 'paper');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-teal')?.size || 0), 0);
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-note')?.size || 0), 0);
    assert.equal(await page.locator('#block-2 .source-text sup').count(), 1);
    assert.equal(await page.locator('#block-2 .translation-text sup').count(), 1);
    assert.equal(await page.locator('#block-3 .source-text table td').count(), 2);
    assert.equal(await page.locator('#block-4 .source-text img').evaluate(img => img.naturalWidth), 1);
    await revealSidebarSource(page);
    assert.match(await page.locator('.failed-stat').innerText(), /Failed\s+1/);
    assert.match(await page.locator('.document-details .side-stat').filter({ hasText: 'Paragraphs' }).innerText(), /Paragraphs\s+5/);
    assert.match(await page.locator('.document-details .side-stat').filter({ hasText: 'Skipped refs' }).innerText(), /Skipped refs\s+2/);
    await page.evaluate(() => {
      const paragraph = document.querySelector('#block-2 .source-text p');
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 7);
      range.setEnd(paragraph.querySelector('sup').firstChild, 1);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('SELECTED TEXT · BLOCK 2', { exact: true }).waitFor();
    assert.match(await page.locator('.inspector blockquote').innerText(), /Vaswani∗/);
    await page.locator('.inspector .highlight.amber').click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size), 1);
    await page.locator('.inspector textarea').fill('Author marker is preserved.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await waitForNoteUnderline(page, '#block-2 .source-text', 'Vaswani∗');
    const saved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
    assert.deepEqual(saved.blocks[1].highlights.filter(item => item.scope === 'reader').map(item => ({ scope: item.scope, text: item.text, offset: item.offset })), [{ scope: 'reader', text: 'Vaswani∗', offset: 7 }]);
    assert.equal(saved.blocks[1].notes.find(item => item.scope === 'reader').body, 'Author marker is preserved.');
    await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Translation', exact: true }).check();
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'The third occurrence belongs to block seven.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Paper' && window.getSelection()?.toString() === 'repeat');
    assert.equal(await page.locator('.inspector textarea').inputValue(), 'The third occurrence belongs to block seven.');
    await page.getByLabel('Back to previous reading location').click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Reader' && document.querySelector('[role="radiogroup"][aria-label="Reading mode"] input:checked')?.value === 'translation');
    await page.getByLabel('Forward in reading history').click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Paper');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Author marker is preserved.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('[role="radiogroup"][aria-label="Reading mode"] input:checked')?.value === 'bilingual' && window.getSelection()?.toString() === 'Vaswani∗');
    await page.evaluate(() => {
      const paragraph = document.querySelector('#block-2 .translation-text p');
      const range = document.createRange(); range.setStart(paragraph.firstChild, 0); range.setEnd(paragraph.firstChild, 3);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill('Translation wording is saved.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await waitForNoteUnderline(page, '#block-2 .translation-text', '阿什什');
    await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Original', exact: true }).check();
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Translation wording is saved.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('[role="radiogroup"][aria-label="Reading mode"] input:checked')?.value === 'bilingual' && window.getSelection()?.toString() === '阿什什');
    assert.equal(await page.locator('.inspector textarea').inputValue(), 'Translation wording is saved.');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Retain this stale note.' }).locator('button').first().click();
    await page.getByText('The saved Reader text no longer matches this block.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '阿什什');
    assert.equal(await page.getByRole('button', { name: 'Reader', exact: true }).getAttribute('class'), 'active');
    await page.waitForFunction(async paperId => (await window.paperBridge.loadPaper(paperId))?.blocks[5]?.notes[0]?.needsReview === true, id);
    const afterInvalidJump = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
    assert.equal(afterInvalidJump.blocks[5].notes[0].needsReview, true);
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-teal')?.size), 1);
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    assert.equal(await selectFormula(page.locator('#block-2 .source-text p')), formulaQuote);
    assert.equal(await page.locator('.inspector blockquote').innerText(), formulaQuote);
    await page.locator('.inspector textarea').fill('Reader formula selection');
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.screenshot({ path: path.join(artifacts, 'markdown-parity-reader.png') });
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await page.getByText('1 unfinished block(s) shown in the original language.', { exact: true }).waitFor();
    await page.getByText('Full translation saved with 1 unfinished block(s).', { exact: false }).waitFor();
    const draft = page.locator('[data-view-scope="fullTranslation"]');
    assert.match(await draft.innerText(), /阿什什∗报告了一个测量结果/);
    assert.match(await draft.innerText(), /A paragraph whose previous translation failed/);
    assert.match(await draft.innerText(), /Reference entry remains in the original language/);
    assert.equal(await draft.locator('table td').count(), 2);
    assert.equal(await draft.locator('img[src^="data:image/png"]').count(), 2);
    assert.equal(requests.length, 4, 'Only unfinished text blocks should be submitted');
    for (const input of requests) {
      assert.doesNotMatch(input, /Ashish Vaswani|data:image|iVBORw0K|Reference entry|<table>/);
    }
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-1 .translation-text').getByText('研究标题', { exact: true }).waitFor();
    await page.locator('#block-6 .failure').getByRole('button', { name: 'Retry', exact: true }).click();
    await page.locator('#block-6 .translation-text').getByText('已恢复的段落译文。', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await draft.getByText('已恢复的段落译文。', { exact: true }).waitFor();
    assert.equal(requests.length, 5, 'A Reader retry should update the full draft without regenerating other blocks');
    await draft.focus();
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await page.locator('.inspector blockquote').textContent(), '研');
    assert.equal(await selectFormula(draft.locator('p').filter({ has: page.locator('.katex') })), formulaQuote);
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill('Full translation formula selection');
    await page.getByRole('button', { name: 'Save note' }).click();
    await waitForNoteUnderline(page, '[data-view-scope="fullTranslation"]', formulaQuote);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    for (const side of ['summarySource', 'summaryTarget']) {
      const card = page.locator(`[data-view-scope="${side}"]`);
      await card.focus();
      await page.evaluate(() => window.getSelection().removeAllRanges());
      await page.keyboard.press('Control+Shift+ArrowRight');
      assert.equal(await page.locator('.inspector blockquote').textContent(), 'A');
      assert.equal(await selectFormula(card.locator('p').first()), formulaQuote);
      await page.locator('.inspector .highlight.coral').click();
      await page.locator('.inspector textarea').fill(`Formula in ${side}`);
      await page.getByRole('button', { name: 'Save note' }).click();
      await waitForNoteUnderline(page, `[data-view-scope="${side}"]`, formulaQuote);
    }
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('markdown:export');
      ipcMain.handle('markdown:export', (_event, document) => { globalThis.__sharedMarkdownExport = document.content; return 'fixture.md'; });
    });
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Full Translation Markdown', exact: true }).click();
    await page.getByText('Exported fixture.md', { exact: true }).waitFor();
    const exported = await app.evaluate(() => globalThis.__sharedMarkdownExport);
    assert.match(exported, /已恢复的段落译文/);
    assert.ok(exported.includes(figure), 'Export keeps the image with the shared draft');
    await page.waitForFunction(async paperId => {
      const saved = await window.paperBridge.loadPaper(paperId);
      return saved?.connectedShared && saved.position?.tab === 'Full Translation' && saved.connectedTranslation.includes('已恢复的段落译文');
    }, id);
    await page.reload();
    await draft.getByText('已恢复的段落译文。', { exact: true }).waitFor();
    for (const note of ['Paper formula selection', 'Reader formula selection', 'Formula in summarySource', 'Formula in summaryTarget', 'Full translation formula selection']) {
      await page.locator('.saved-annotations .annotation-row').filter({ hasText: note }).locator('button').first().click();
      await page.waitForFunction(({ quote, note }) => {
        const selected = window.getSelection();
        if (!selected?.rangeCount || selected.isCollapsed) return false;
        const fragment = selected.getRangeAt(0).cloneContents();
        fragment.querySelectorAll('.katex-mathml').forEach(node => node.remove());
        return fragment.textContent === quote && document.querySelector('.inspector textarea')?.value === note;
      }, { quote: formulaQuote, note });
    }
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'A moved summary phrase' }).locator('button').first().click();
    await page.waitForFunction(() => window.getSelection()?.toString() === 'identical layers' &&
      document.querySelector('.inspector textarea')?.value === 'A moved summary phrase');
    await page.locator('.inspector textarea').fill('Edited the moved summary phrase.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.waitForFunction(async paperId => {
      const saved = await window.paperBridge.loadPaper(paperId);
      const notes = saved?.viewNotes.filter(item => item.scope === 'summarySource' && item.text === 'identical layers');
      return notes?.length === 1 && notes[0].id === 'moved-summary' && notes[0].body === 'Edited the moved summary phrase.' &&
        notes[0].offset === saved.summary.source.indexOf(notes[0].text) && !notes[0].renderedAnchor;
    }, id);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'A changed summary annotation' }).locator('button').first().click();
    await page.getByText('The saved Markdown text no longer matches this view.', { exact: false }).waitFor();
    await page.waitForFunction(async paperId => (await window.paperBridge.loadPaper(paperId))?.viewNotes.find(item => item.id === 'shifted-summary')?.needsReview, id);
    assert.equal(requests.length, 5, 'Reopening a completed draft should not issue model requests');

    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    await page.getByLabel('Paper display mode').selectOption('bilingual');
    await page.locator('[data-paper-block-id="2"] [data-paper-kind="source"] .katex').waitFor();
    await page.evaluate(() => {
      const root = document.querySelector('[data-view-scope="paperArticle"]');
      const start = root.querySelector('[data-paper-block-id="1"] h1').firstChild;
      const end = root.querySelector('[data-paper-block-id="2"] [data-paper-kind="source"] .katex').nextSibling;
      const range = document.createRange();
      range.setStart(start, 'Research '.length);
      range.setEnd(end, end.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('SELECTED TEXT · PAPER', { exact: true }).waitFor();
    const crossQuote = await page.locator('.inspector blockquote').textContent();
    assert.match(crossQuote, /^title\n研究标题\nAshish Vaswani∗/);
    assert.ok(crossQuote.endsWith(formulaQuote + '.'));
    assert.doesNotMatch(crossQuote, /Translation unavailable|\$N|Formula/);
    const crossNote = 'This note spans Paper sections.';
    await page.locator('.inspector .highlight.amber').click();
    await page.locator('.inspector textarea').fill(crossNote);
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.waitForFunction(async ({ id, crossNote }) => (await window.paperBridge.loadPaper(id))?.viewNotes.some(item => item.body === crossNote), { id, crossNote });
    const crossSaved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
    for (const list of [crossSaved.viewNotes, crossSaved.viewHighlights]) {
      const saved = list.filter(item => item.scope === 'paperArticle');
      assert.equal(saved.length, 1);
      assert.equal(saved[0].text, crossQuote);
      assert.equal(saved[0].displayMode, 'bilingual');
      assert.equal(saved[0].sourceMode, 'mineru');
      assert.equal(saved[0].renderedSource, undefined);
    }
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size), 1);

    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Summary, sources and notes', exact: true }).click();
    await page.getByText('Exported fixture.md', { exact: true }).waitFor();
    const crossExport = await app.evaluate(() => globalThis.__sharedMarkdownExport);
    assert.ok(crossExport.includes('## Other Saved Highlights and Notes'));
    assert.ok(crossExport.includes('### Paper · document preview · amber\n\n> ' + crossQuote.replaceAll('\n', '\n> ') + '\n\nNote: ' + crossNote));
    assert.equal(crossExport.split(crossNote).length - 1, 1, 'the same-range highlight and note export together');

    await page.getByLabel('Paper display mode').selectOption('translation');
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size || 0), 0);
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.waitForFunction(async paperId => {
      const position = (await window.paperBridge.loadPaper(paperId))?.position;
      return position?.tab === 'Reader' && position.displayMode === 'translation';
    }, id);
    await page.reload();
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: crossNote }).locator('button').first().click();
    await page.waitForFunction(({ crossQuote, crossNote }) => {
      const selected = window.getSelection();
      if (!selected?.rangeCount) return false;
      const fragment = selected.getRangeAt(0).cloneContents();
      fragment.querySelectorAll('.katex-mathml, [data-selection-ignore]').forEach(node => node.remove());
      return fragment.textContent === crossQuote && document.querySelector('.inspector textarea')?.value === crossNote;
    }, { crossQuote, crossNote });
    assert.equal(await page.getByLabel('Paper display mode').inputValue(), 'bilingual');
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size), 1);
    await waitForNoteUnderline(page, '[data-view-scope="paperArticle"]', crossQuote);
    await page.getByLabel('Back to previous reading location').click();
    assert.equal(await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Translation', exact: true }).isChecked(), true);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: crossNote }).locator('button').first().click();
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Paper · document preview · amber' }).getByRole('button', { name: /^Remove view highlight/ }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size || 0), 0);
    await page.getByRole('button', { name: 'Undo last highlight or note change' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size), 1);
    await app.close();
    const savedPath = path.join(workspace, 'papers', `${id}.json`);
    const moved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    moved.blocks[0].sourceMarkdown = '# Reframed research title';
    moved.blocks[0].text = moved.blocks[0].sourceMarkdown;
    moved.connectedTranslation = 'Revised introduction.\n\n' + moved.connectedTranslation;
    const crossRecord = moved.viewNotes.find(item => item.body === crossNote);
    fs.writeFileSync(savedPath, JSON.stringify(moved));
    app = await launch();
    const relocated = await app.firstWindow();
    await waitForNoteUnderline(relocated, '[data-view-scope="paperArticle"]', crossQuote);
    await relocated.locator('.saved-annotations .annotation-row').filter({ hasText: 'Full translation formula selection' }).locator('button').first().click();
    await waitForNoteUnderline(relocated, '[data-view-scope="fullTranslation"]', formulaQuote);
    assert.equal(await relocated.locator('.inspector textarea').inputValue(), 'Full translation formula selection');
    await relocated.locator('.saved-annotations .annotation-row').filter({ hasText: crossNote }).locator('button').first().click();
    await waitForNoteUnderline(relocated, '[data-view-scope="paperArticle"]', crossQuote);
    assert.equal(await relocated.locator('.inspector textarea').inputValue(), crossNote);
    const relocatedBody = crossNote + ' Edited after the source moved.';
    await relocated.locator('.inspector textarea').fill(relocatedBody);
    await relocated.getByRole('button', { name: 'Save note' }).click();
    await relocated.waitForFunction(async ({ id, old, relocatedBody }) => {
      const paper = await window.paperBridge.loadPaper(id);
      const notes = paper?.viewNotes.filter(item => item.scope === 'paperArticle');
      return notes?.length === 1 && notes[0].id === old.id && notes[0].body === relocatedBody &&
        notes[0].renderedAnchor.offset > old.renderedAnchor.offset;
    }, { id, old: crossRecord, relocatedBody });
    await app.close();

    const changed = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    changed.blocks[1].sourceMarkdown = changed.blocks[1].sourceMarkdown.replace('Ashish', 'Changed');
    changed.blocks[1].text = changed.blocks[1].text.replace('Ashish', 'Changed');
    fs.writeFileSync(savedPath, JSON.stringify(changed));
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.locator('.saved-annotations .annotation-row').filter({ hasText: crossNote }).locator('button').first().click();
    await reopened.getByText('The saved Markdown text no longer matches this view.', { exact: false }).waitFor();
    assert.equal(await reopened.evaluate(() => CSS.highlights.get('paperbridge-amber')?.size || 0), 0);
    assert.equal(await reopened.evaluate(() => [...(CSS.highlights.get('paperbridge-note') || [])]
      .some(range => range.startContainer.parentElement.closest('[data-paper-block-id="1"]') &&
        range.endContainer.parentElement.closest('[data-paper-block-id="2"]'))), false);
    await reopened.waitForFunction(async ({ id, relocatedBody, crossQuote }) => {
      const record = (await window.paperBridge.loadPaper(id))?.viewNotes.find(item => item.body === relocatedBody);
      return record?.needsReview && record.text === crossQuote;
    }, { id, relocatedBody, crossQuote });
    await reopened.locator('.saved-annotations .annotation-row').filter({ hasText: 'Author marker is preserved.' }).locator('button').first().click();
    await reopened.waitForFunction(() => window.getSelection()?.toString() === 'Vaswani∗');
    assert.equal(await reopened.locator('.inspector textarea').inputValue(), 'Author marker is preserved.');
    await waitForNoteUnderline(reopened, '#block-2 .source-text', 'Vaswani∗');
    await reopened.locator('.inspector .highlight.teal').click();
    await reopened.waitForFunction(async paperId => {
      const block = (await window.paperBridge.loadPaper(paperId))?.blocks[1];
      const highlights = block?.highlights.filter(item => item.scope === 'reader' && item.text === 'Vaswani∗');
      return highlights?.length === 1 && highlights[0].color === 'teal' && highlights[0].offset === 'Changed '.length;
    }, id);
    await reopened.getByRole('button', { name: 'Paper', exact: true }).click();
    await reopened.waitForFunction(() => document.querySelector('.document-preview table img[alt="Table panel"]')?.naturalWidth === 1);
    const exports = path.join(workspace, 'exports');
    fs.mkdirSync(exports);
    await app.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      shell.showItemInFolder = destination => {
        const fs = process.getBuiltinModule('node:fs');
        const path = process.getBuiltinModule('node:path');
        globalThis.__revealedBundle = { destination, original: fs.readFileSync(path.join(destination, 'paper_original.md'), 'utf8') };
      };
    }, exports);
    await reopened.getByRole('button', { name: 'More ···', exact: true }).click();
    await reopened.locator('.modal').getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
    await reopened.getByText(/1 referenced local asset\(s\) could not be included/).waitFor();
    const bundle = path.join(exports, fs.readdirSync(exports)[0]);
    assert.equal(path.basename(bundle), 'Markdown parity fixture_PaperBridge');
    const original = fs.readFileSync(path.join(bundle, 'paper_original.md'), 'utf8');
    assert.deepEqual(await app.evaluate(() => globalThis.__revealedBundle), { destination: bundle, original });
    const panel = original.match(/<img src="(assets\/[a-f0-9]+\.png)" alt="Table panel">/)?.[1];
    const data = original.match(/\[Measurements\]\((assets\/local-[a-f0-9]+\.csv)#rows\)/)?.[1];
    assert.ok(panel && data);
    assert.ok(original.includes(`![Figure](${panel})`), 'HTML and Markdown figures share one copy of the same bytes');
    assert.ok(original.includes('[Missing appendix](data/missing.csv)'));
    assert.deepEqual(fs.readFileSync(path.join(bundle, panel)), figureBytes);
    assert.equal(fs.readFileSync(path.join(bundle, data), 'utf8'), measurements);
    const translatedFile = fs.readFileSync(path.join(bundle, 'paper_translation_zh-Hans.md'), 'utf8');
    const bilingualFile = fs.readFileSync(path.join(bundle, 'paper_bilingual_en_zh-Hans.md'), 'utf8');
    assert.equal(fs.readFileSync(path.join(bundle, 'paper_full_translation_zh-Hans.md'), 'utf8'), translatedFile);
    assert.match(bilingualFile, /> \*\*Simplified Chinese translation\*\*\n>\n> /);
    for (const edition of [translatedFile, bilingualFile]) {
      assert.ok(edition.includes(`![Figure](${panel})`));
      assert.ok(edition.includes(`[Measurements](${data}#rows)`));
      assert.ok(edition.includes('$N = 6$'));
    }
    console.log('Markdown rendering, annotations, shared translation and portable export of HTML figures and supplementary files verified.');
  } finally {
    await app?.close();
    await new Promise(resolve => ollama.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
