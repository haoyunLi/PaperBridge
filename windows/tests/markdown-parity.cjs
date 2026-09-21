const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'markdown-parity-workspace');
  if (!path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep)) throw new Error('Unexpected workspace path');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'papers'), { recursive: true });
  const id = 'a'.repeat(64);
  const figure = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';
  const parts = [
    '# Research title',
    'Ashish Vaswani<sup>∗</sup> reported a measured result.',
    '<table><thead><tr><th>Method</th><th>Score</th></tr></thead><tbody><tr><td>Attention</td><td>42</td></tr></tbody></table>',
    `![Figure](${figure})`,
    'Unsafe <img src="javascript:alert(1)" onerror="window.__paperbridgeUnsafe=true"><script>window.__paperbridgeUnsafe=true</script> text.',
    'A paragraph whose previous translation failed.',
    'Repeat repeat repeat.'
  ];
  const blocks = parts.map((sourceMarkdown, index) => ({
    id: index + 1, sourceMarkdown, text: sourceMarkdown, heading: index === 0,
    resource: index === 2 || index === 3, status: index === 1 ? 'ok' : index === 5 ? 'failed' : 'pending',
    translation: index === 1 ? '阿什什<sup>∗</sup>报告了一个测量结果。' : '',
    translationMarkdown: index === 1 ? '阿什什<sup>∗</sup>报告了一个测量结果。' : null,
    error: index === 5 ? 'Local model stopped.' : '', highlights: [], translationHighlights: [],
    notes: index === 5 ? [{ id: 'stale-note', text: 'Missing citation', offset: 0, kind: 'source', body: 'Retain this stale note.' }] : []
  }));
  fs.writeFileSync(path.join(workspace, 'papers', `${id}.json`), JSON.stringify({
    id, name: 'Markdown parity fixture', type: 'text', blocks,
    mineruMarkdown: parts.join('\n\n'), sourceMode: 'mineru', extraction: 'MinerU',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    position: { tab: 'Paper', block: 1, displayMode: 'bilingual' }
  }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    fontSize: 21, lineHeight: 1.9, readingWidth: 700, autoCheckUpdates: false, onboardingCompletedVersion: 1
  }));
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('heading', { name: 'Markdown parity fixture' }).waitFor();
    assert.equal(await page.locator('.document-preview sup').count(), 1);
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
    await page.evaluate(() => {
      const paragraph = document.querySelector('[data-paper-block-id="7"] p');
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 14);
      range.setEnd(paragraph.firstChild, 20);
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByText('SELECTED TEXT · BLOCK 7', { exact: true }).waitFor();
    await page.locator('.inspector .highlight.blue').click();
    await page.locator('.inspector textarea').fill('The third occurrence belongs to block seven.');
    await page.getByRole('button', { name: 'Save note' }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-blue')?.size), 1);
    const previewSaved = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
    assert.deepEqual(previewSaved.blocks[6].highlights.map(item => ({ text: item.text, offset: item.offset })), [{ text: 'repeat', offset: 14 }]);
    assert.equal(previewSaved.blocks[6].notes[0].offset, 14);
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
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
    assert.deepEqual(saved.blocks[1].highlights.map(item => ({ text: item.text, offset: item.offset })), [{ text: 'Vaswani∗', offset: 7 }]);
    assert.equal(saved.blocks[1].notes[0].body, 'Author marker is preserved.');
    await page.getByLabel('Reading mode').selectOption('translation');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'The third occurrence belongs to block seven.' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.reader-mode-select')?.value === 'bilingual' && window.getSelection()?.toString() === 'repeat');
    assert.equal(await page.locator('.inspector textarea').inputValue(), 'The third occurrence belongs to block seven.');
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'Author marker is preserved.' }).locator('button').first().click();
    await page.waitForFunction(() => window.getSelection()?.toString() === 'Vaswani∗');
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
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '');
    await page.waitForFunction(async paperId => (await window.paperBridge.loadPaper(paperId))?.blocks[5]?.notes[0]?.needsReview === true, id);
    const afterInvalidJump = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', `${id}.json`), 'utf8'));
    assert.equal(afterInvalidJump.blocks[5].notes[0].needsReview, true);
    await page.getByRole('button', { name: 'Paper', exact: true }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.get('paperbridge-blue')?.size), 1);
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, 'markdown-parity-reader.png') });
    console.log('Markdown HTML, image, table, typography, repeated-text anchors, source and translation note navigation, and rich highlights verified.');
  } finally {
    await app.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
