// Opt in with the public arXiv PDF used by mac-paper-layout/Observe.swift.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function selectedLabel(page) {
  return page.evaluate(() => {
    const selected = window.getSelection();
    if (selected?.toString().trim() !== 'application' || !selected.rangeCount) return null;
    const range = selected.getRangeAt(0);
    const layer = range.startContainer.parentElement.closest('.textLayer');
    if (!layer) return null;
    const text = range.getBoundingClientRect(), box = layer.getBoundingClientRect();
    return { page: Number(layer.dataset.page), quote: selected.toString().trim(),
      x: (text.x + text.width / 2 - box.x) / box.width, y: (text.y + text.height / 2 - box.y) / box.height };
  });
}

async function saveNote(page, id, body) {
  await page.getByLabel('Note for selected passage').fill(body);
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.waitForFunction(async ({ id, body }) => (await window.paperBridge.loadPaper(id))?.pdfNotes?.some(item => item.body === body), { id, body });
}

async function textRange(layer, start, end, occurrence = 0) {
  await layer.evaluate((element, { start, end, occurrence }) => {
    const spans = [...element.querySelectorAll('span[role="presentation"]')];
    const first = spans.filter(span => span.textContent === start)[occurrence].firstChild;
    const last = start === end ? first : spans.find(span => span.textContent === end).firstChild;
    const range = new Range();
    range.setStart(first, 0); range.setEnd(last, last.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { start, end, occurrence });
}

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  const pdf = fs.readFileSync(process.env.PAPERBRIDGE_ATTENTION_PDF || path.join(artifacts, 'attention-is-all-you-need.pdf'));
  const id = createHash('sha256').update(pdf).digest('hex');
  assert.equal(id, 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697');
  const dir = fs.mkdtempSync(path.join(artifacts, 'figure-notes-'));
  fs.mkdirSync(path.join(dir, 'papers')); fs.mkdirSync(path.join(dir, 'pdfs'));
  fs.writeFileSync(path.join(dir, 'pdfs', id + '.pdf'), pdf);
  const file = path.join(dir, 'papers', id + '.json');
  const paper = { id, name: 'Attention Is All You Need', pageCount: 15, type: 'pdf', sourceMode: 'pdf',
    blocks: [{ id: 1, text: 'Attention Visualizations', heading: true }], inspectorOpen: true, position: { tab: 'Original', page: 14, block: 1 } };
  fs.writeFileSync(file, JSON.stringify(paper));
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const previous = process.env.PAPERBRIDGE_PREVIOUS_EXECUTABLE;
  const launch = (executablePath = exe) => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')], env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch(previous || exe);
  try {
    let page = await app.firstWindow();
    const observations = [];
    await openWorkspaceView(page, 'Original');
    if (previous) {
      const old = page.locator('.textLayer[data-page="14"]');
      await old.locator('span[role="presentation"]').filter({ hasText: /^missing$/ }).nth(3).dblclick();
      await page.locator('.inspector blockquote').filter({ hasText: /^missing$/ }).first().waitFor();
      await saveNote(page, id, 'Older visible label');
      await textRange(old, 'Input-Input Layer5', 'Input-Input Layer5', 1);
      await page.locator('.inspector blockquote').filter({ hasText: /^Input-Input Layer5$/ }).first().waitFor();
      await saveNote(page, id, 'Older clipped label');
      await app.close(); app = await launch(); page = await app.firstWindow();
      await openWorkspaceView(page, 'Reader');
      await page.locator('.annotation-row').filter({ hasText: 'Older visible label' }).getByRole('button').first().click();
      await page.waitForFunction(() => getSelection()?.toString() === 'missing');
      assert.equal(await page.getByLabel('Note for selected passage').inputValue(), 'Older visible label');
      await page.locator('.annotation-row').filter({ hasText: 'Older clipped label' }).getByRole('button').first().click();
      await page.waitForFunction(async id => (await window.paperBridge.loadPaper(id))?.pdfNotes?.some(n => n.body === 'Older clipped label' && n.needsReview), id);
      assert.equal(JSON.parse(fs.readFileSync(file)).pdfNotes.length, 2);
    }
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    const heading = page.locator('.textLayer[data-page="13"]');
    await heading.waitFor();
    await textRange(heading, 'Attention Visualizations', 'It');
    const preview = page.locator('.inspector blockquote').first();
    await preview.filter({ hasText: /Attention Visualizations/ }).waitFor();
    assert.ok(!(await preview.textContent()).includes('Input-Input Layer5'));
    await saveNote(page, id, 'Printed heading and first axis label');
    const crossing = JSON.parse(fs.readFileSync(file)).pdfNotes.find(n => n.body === 'Printed heading and first axis label');
    assert.match(crossing.anchors[0].text, /Input-Input Layer5/);
    assert.ok(crossing.quote.includes('Attention Visualizations') && !crossing.quote.includes('Input-Input'));
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    for (const number of [14, 15]) {
      if (number === 15) await page.getByRole('button', { name: 'Next page', exact: true }).click();
      const layer = page.locator('.textLayer[data-page="' + number + '"]');
      const words = layer.locator('span[role="presentation"]').filter({ hasText: /^application$/ });
      await words.nth(3).waitFor({ timeout: 15000 });
      assert.equal(await words.count(), 4);
      for (const index of [3, 0, 2, 1]) {
        await words.nth(index).dblclick();
        await page.locator('.inspector blockquote').filter({ hasText: /^application$/ }).first().waitFor();
        const match = await selectedLabel(page);
        assert.equal(match?.page, number, 'Double-click must select the printed label on page ' + number);
        const body = 'Figure ' + (number - 10) + ', label ' + (index + 1);
        await saveNote(page, id, body);
        observations.push({ ...match, body });
      }
    }
    const notes = JSON.parse(fs.readFileSync(file)).pdfNotes.filter(n => n.body.startsWith('Figure '));
    assert.equal(notes.length, 8);
    assert.equal(new Set(notes.map(n => n.anchors[0].page + ':' + n.anchors[0].offset)).size, 8);
    assert.ok(notes.every(n => n.anchors.length === 1 && n.anchors[0].text === 'application'));
    await app.close();
    app = await launch(); page = await app.firstWindow();
    await openWorkspaceView(page, 'Original');
    await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
    for (const prior of observations) {
      await openWorkspaceView(page, 'Reader');
      await page.locator('.annotation-row').filter({ hasText: prior.body }).getByRole('button').first().click();
      await page.waitForFunction(() => window.getSelection()?.toString() === 'application');
      const selected = await selectedLabel(page);
      assert.equal(selected.page, prior.page);
      assert.ok(Math.abs(selected.x - prior.x) < 0.01 && Math.abs(selected.y - prior.y) < 0.01, prior.body + ' moved on the page');
      assert.equal(await page.getByLabel('Note for selected passage').inputValue(), prior.body);
    }
    await page.locator('.annotation-row').filter({ hasText: crossing.body }).getByRole('button').first().click();
    await page.getByLabel('Note for selected passage').waitFor();
    await page.waitForFunction(quote => document.querySelector('.inspector blockquote')?.textContent === quote, crossing.quote);
    if (process.env.PAPERBRIDGE_MAC_FIGURES) {
      const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_FIGURES, 'utf8')).axisNotes;
      assert.equal(native.length, observations.length);
      for (const prior of observations) {
        const matches = native.filter(n => n.page === prior.page && n.quote === prior.quote && Math.abs(n.x - prior.x) < 0.015 && Math.abs(n.y - prior.y) < 0.015);
        assert.equal(matches.length, 1, 'No unique native PDFKit range at ' + prior.body);
      }
    }
    console.log(JSON.stringify({ workspace: dir, labels: observations, reopened: true, upgraded: Boolean(previous), printedQuote: crossing.quote, native: Boolean(process.env.PAPERBRIDGE_MAC_FIGURES) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
