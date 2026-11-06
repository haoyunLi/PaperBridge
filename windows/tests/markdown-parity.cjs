const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');

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
  const parts = [
    '# Research title',
    'Ashish Vaswani<sup>∗</sup> reported a measured result. ' + formula,
    '<table><thead><tr><th>Method</th><th>Score</th></tr></thead><tbody><tr><td>Attention</td><td>42</td></tr></tbody></table>',
    `![Figure](${figure})`,
    'Unsafe <img src="javascript:alert(1)" onerror="window.__paperbridgeUnsafe=true"><script>window.__paperbridgeUnsafe=true</script> text.',
    'A paragraph whose previous translation failed.',
    'Repeat repeat repeat.',
    '## References',
    '[1] Reference entry remains in the original language.'
  ];
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
    mineruMarkdown: parts.join('\n\n'), sourceMode: 'mineru', extraction: 'MinerU',
    summary: { source: formula, target: formula, sourceLanguage: 'English', targetLanguage: 'Chinese' },
    viewNotes: [{ id: 'shifted-summary', scope: 'summarySource', text: 'stack', offset: null,
      renderedAnchor: { offset: 2, before: 'A ', after: ' was here' }, body: 'A changed summary annotation' }],
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
  let app;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('heading', { name: 'Markdown parity fixture' }).waitFor();
    assert.equal(await page.locator('.document-preview [data-paper-kind="source"] sup').count(), 1);
    assert.equal(await page.locator('.document-preview [data-paper-kind="translation"] sup').count(), 1);
    assert.equal(await page.locator('.document-preview table td').allInnerTexts().then(cells => cells.join(',')), 'Attention,42');
    assert.equal(await page.locator('.document-preview img[src^="data:image/png"]').count(), 1);
    assert.equal(await page.locator('.document-preview img[src^="data:image/png"]').evaluate(img => img.naturalWidth), 1);
    assert.equal(await page.locator('.document-preview script').count(), 0);
    assert.equal(await page.locator('.document-preview [onerror]').count(), 0);
    assert.equal(await page.evaluate(() => window.__paperbridgeUnsafe), undefined);
    const paperStyle = await page.locator('.document-preview').evaluate(node => ({ size: getComputedStyle(node).fontSize, line: getComputedStyle(node).lineHeight, width: node.getBoundingClientRect().width }));
    assert.equal(paperStyle.size, '21px');
    assert.ok(paperStyle.width <= 701);
    assert.ok(Number.parseFloat(paperStyle.line) > 35);
    const formulaQuote = await selectFormula(page.locator('[data-paper-block-id="2"] [data-paper-kind="source"] p'));
    assert.match(formulaQuote, /^stack of N\s*=\s*6 identical layers$/);
    assert.equal(await page.locator('.inspector blockquote').innerText(), formulaQuote);
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill('Paper formula selection');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-coral')?.size), 1);
    await page.waitForFunction(async paperId => (await window.paperBridge.loadPaper(paperId))?.blocks[1].notes.some(item => item.body === 'Paper formula selection'), id);
    const formulaSaved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8')).blocks[1];
    for (const item of [...formulaSaved.notes, ...formulaSaved.highlights]) {
      assert.equal(item.text, formulaQuote);
      assert.equal(item.offset, null);
      assert.equal(item.renderedAnchor.offset, item.displayOffset);
      assert.equal(item.renderedSource, undefined);
      assert.equal(item.renderedText, undefined);
    }
    await page.evaluate(() => {
      const paragraph = document.querySelector('[data-paper-block-id="7"] p');
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 14);
      range.setEnd(paragraph.firstChild, 20);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('SELECTED TEXT · BLOCK 7', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.teal').click();
    await page.locator('.inspector textarea').fill('The third occurrence belongs to block seven.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-teal')?.size), 1);
    const previewSaved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
    assert.deepEqual(previewSaved.blocks[6].highlights.map(item => ({ scope: item.scope, text: item.text, offset: item.offset })), [{ scope: 'paper', text: 'repeat', offset: 14 }]);
    assert.equal(previewSaved.blocks[6].notes[0].offset, 14);
    assert.equal(previewSaved.blocks[6].notes[0].scope, 'paper');
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-teal')?.size || 0), 0);
    assert.equal(await page.locator('#block-2 .source-text sup').count(), 1);
    assert.equal(await page.locator('#block-2 .translation-text sup').count(), 1);
    assert.equal(await page.locator('#block-3 .source-text table td').count(), 2);
    assert.equal(await page.locator('#block-4 .source-text img').evaluate(img => img.naturalWidth), 1);
    assert.match(await page.locator('.failed-stat').innerText(), /Failed\s+1/);
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
    const saved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
    assert.deepEqual(saved.blocks[1].highlights.filter(item => item.scope === 'reader').map(item => ({ scope: item.scope, text: item.text, offset: item.offset })), [{ scope: 'reader', text: 'Vaswani∗', offset: 7 }]);
    assert.equal(saved.blocks[1].notes.find(item => item.scope === 'reader').body, 'Author marker is preserved.');
    await page.getByLabel('Reading mode').selectOption('translation');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'The third occurrence belongs to block seven.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Paper' && window.getSelection()?.toString() === 'repeat');
    assert.equal(await page.locator('.inspector textarea').inputValue(), 'The third occurrence belongs to block seven.');
    await page.getByLabel('Back to previous reading location').click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Reader' && document.querySelector('.reader-mode-select')?.value === 'translation');
    await page.getByLabel('Forward in reading history').click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Paper');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Author marker is preserved.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.reader-mode-select')?.value === 'bilingual' && window.getSelection()?.toString() === 'Vaswani∗');
    await page.evaluate(() => {
      const paragraph = document.querySelector('#block-2 .translation-text p');
      const range = document.createRange(); range.setStart(paragraph.firstChild, 0); range.setEnd(paragraph.firstChild, 3);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill('Translation wording is saved.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.getByLabel('Reading mode').selectOption('source');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Translation wording is saved.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.reader-mode-select')?.value === 'bilingual' && window.getSelection()?.toString() === '阿什什');
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
    assert.equal(await draft.locator('img[src^="data:image/png"]').count(), 1);
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
    assert.equal(await selectFormula(draft.locator('p').filter({ has: page.locator('.katex') })), formulaQuote);
    await page.locator('.inspector .highlight.coral').click();
    await page.locator('.inspector textarea').fill('Full translation formula selection');
    await page.getByRole('button', { name: 'Save note' }).click();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    for (const side of ['summarySource', 'summaryTarget']) {
      assert.equal(await selectFormula(page.locator(`[data-view-scope="${side}"] p`)), formulaQuote);
      await page.locator('.inspector .highlight.coral').click();
      await page.locator('.inspector textarea').fill(`Formula in ${side}`);
      await page.getByRole('button', { name: 'Save note' }).click();
    }
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('markdown:export');
      ipcMain.handle('markdown:export', (_event, document) => { globalThis.__sharedMarkdownExport = document.content; return 'fixture.md'; });
    });
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Markdown', exact: true }).click();
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
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'A changed summary annotation' }).locator('button').first().click();
    await page.getByText('The saved Markdown text no longer matches this view.', { exact: false }).waitFor();
    await page.waitForFunction(async paperId => (await window.paperBridge.loadPaper(paperId))?.viewNotes.find(item => item.id === 'shifted-summary')?.needsReview, id);
    assert.equal(requests.length, 5, 'Reopening a completed draft should not issue model requests');
    console.log('Markdown rendering, exact annotations, and shared full translation, retry, and export verified.');
  } finally {
    await app?.close();
    await new Promise(resolve => ollama.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
