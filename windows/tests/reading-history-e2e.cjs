const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

function samplePdf() {
  const streams = [
    'BT /F1 18 Tf 72 720 Td (First page history context.) Tj ET',
    'BT /F1 18 Tf 72 720 Td (Second page history target appears here.) Tj ET'
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const start = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return `${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
}

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* atomic saves can briefly move the file */ }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function selectPdfText(page, quote) {
  await page.waitForFunction(() => document.querySelector('.textLayer')?.dataset.page === '2');
  await page.evaluate(quote => {
    const host = document.querySelector('.textLayer');
    const source = host.textContent || '';
    const offset = source.indexOf(quote);
    if (offset < 0 || offset !== source.lastIndexOf(quote)) throw new Error(`Expected one PDF quote: ${quote}`);
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
  }, quote);
  await page.waitForFunction(text => document.querySelector('.inspector blockquote')?.textContent === text, quote);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'reading-history-workspace');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, 'papers'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'pdfs'), { recursive: true });
  const id = crypto.createHash('sha256').update('PaperBridge reading history fixture').digest('hex');
  const otherId = crypto.createHash('sha256').update('PaperBridge second history fixture').digest('hex');
  const settings = { ollamaBaseURL: 'http://127.0.0.1:11434', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', autoCheckUpdates: false, onboardingCompletedVersion: 1 };
  const filler = ' Supporting detail keeps this reading surface tall enough to exercise exact scroll restoration.'.repeat(10);
  const texts = ['Abstract', `Opening context.${filler}`, 'Methods', `Unique evidence phrase supports the history target.${filler}`, 'Results', `Result details remain available.${filler}`, 'Discussion', `Discussion details remain available.${filler}`, 'Conclusion', `Closing context remains available.${filler}`];
  const blocks = texts.map((text, index) => ({ id: index + 1, text, heading: index % 2 === 0, translation: '', status: 'pending', bookmark: [4, 6].includes(index + 1), notes: [], highlights: [] }));
  const quote = 'Unique evidence phrase supports the history target.';
  const paper = {
    id, name: 'Reading history fixture.pdf', type: 'pdf', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
    taskSettings: settings, explanationLanguage: 'English', inspectorOpen: true, extraction: 'PDF.js', sourceMode: 'pdf', blocks, pdfBlocks: blocks,
    position: { block: 2, page: 1, tab: 'Summary', displayMode: 'translation', scrollByTab: { Summary: 0, Reader: 0, 'Original:1': 0, 'Original:2': 0 } },
    summary: { source: `${'Summary context. '.repeat(120)}\n\n${quote}`, target: `摘要内容。${'更多摘要。'.repeat(120)}`,
      sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', claims: [{ text: 'The paper includes a history target.', sources: [{ paragraphID: 4, quote }] }] },
    connectedTranslation: ''
  };
  const other = { ...paper, id: otherId, name: 'Second library paper', type: 'text', blocks: [{ id: 1, text: 'Second paper body.', heading: false, translation: '', status: 'pending' }], pdfBlocks: undefined, summary: null, position: { block: 1, page: 1, tab: 'Paper', displayMode: 'bilingual' } };
  const paperPath = path.join(workspace, 'papers', `${id}.json`);
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(paperPath, JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'papers', `${otherId}.json`), JSON.stringify(other));
  fs.writeFileSync(path.join(workspace, 'pdfs', `${id}.pdf`), samplePdf());
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  const readPaper = () => JSON.parse(fs.readFileSync(paperPath, 'utf8'));

  let app;
  let page;
  try {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 900 });
    await page.getByRole('button', { name: 'Overview', exact: true }).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Overview');
    const back = page.getByRole('button', { name: 'Back to previous reading location', exact: true });
    const forward = page.getByRole('button', { name: 'Forward in reading history', exact: true });
    assert.equal(await back.isDisabled(), true);
    await page.evaluate(() => { const host = document.querySelector('.main-scroll'); host.scrollTop = 360; host.dispatchEvent(new Event('scroll')); });
    const sourceLink = page.getByRole('button', { name: 'Read original block 4 →', exact: true });
    await sourceLink.scrollIntoViewIfNeeded();
    const summaryOffset = await page.locator('.main-scroll').evaluate(element => element.scrollTop);
    await sourceLink.click();
    await page.locator('#block-4').waitFor();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Reader');
    assert.equal(await back.isEnabled(), true);
    await page.locator('.sidebar .outline-row').filter({ hasText: 'Unique evidence phrase' }).click();
    await back.click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Overview');
    assert.ok(Math.abs(await page.locator('.main-scroll').evaluate(element => element.scrollTop) - summaryOffset) < 12, 'Back should restore Summary scroll');
    await forward.click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Reader');

    // A scroll callback queued before Back must not overwrite the restored Summary block.
    await page.evaluate(() => {
      const host = document.querySelector('.main-scroll');
      const target = document.querySelector('#block-8');
      host.scrollTop += target.getBoundingClientRect().top - host.getBoundingClientRect().top + 20;
      host.dispatchEvent(new Event('scroll'));
    });
    await back.click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Overview');
    await new Promise(resolve => setTimeout(resolve, 500));
    await waitFor(() => readPaper().position?.tab === 'Summary' && readPaper().position?.block === 2, 'restored generation to reject a stale scroll callback');
    await page.locator('.sidebar .outline-row').filter({ hasText: 'Result details remain available' }).click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Reader');
    assert.equal(await forward.isDisabled(), true, 'a new jump after Back must clear Forward');

    const search = page.getByPlaceholder('Search paper  Ctrl+F');
    await search.fill('Unique evidence phrase');
    await page.locator('.sidebar .outline-row').filter({ hasText: 'Result details remain available' }).click();
    await back.click();
    await page.waitForFunction(() => document.querySelector('.search')?.value === 'Unique evidence phrase');
    assert.equal(await page.locator('.reader-list .block').count(), 1);
    await forward.click();
    await page.waitForFunction(() => document.querySelector('.search')?.value === '');

    // Create an exact PDF note on page two, then prove annotation navigation records and restores its Reader origin.
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await selectPdfText(page, 'Second page history target');
    await page.getByPlaceholder('What should you remember?').fill('PDF history note');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: 'PDF history note' }).locator('button').first().click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Original' && document.querySelector('.pdf-toolbar')?.textContent.includes('page 2 of 2'));
    await back.click();
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Reader');
    await page.keyboard.press('Control+]');
    await page.waitForFunction(() => document.querySelector('.tabs button.active')?.textContent === 'Original' && document.querySelector('.pdf-toolbar')?.textContent.includes('page 2 of 2'));
    const native = await app.evaluate(({ Menu }) => ({
      back: Menu.getApplicationMenu().getMenuItemById('command:readingBack').enabled,
      forward: Menu.getApplicationMenu().getMenuItemById('command:readingForward').enabled
    }));
    assert.equal(native.back, true);

    await back.click();
    await page.locator('#block-4 button[title="Edit source"]').click();
    await page.locator('#block-4 .edit-area textarea').fill(`${blocks[3].text} Revised.`);
    await page.getByRole('button', { name: 'Save edit', exact: true }).click();
    assert.equal(await back.isDisabled(), true, 'a structure repair must clear Back');
    assert.equal(await forward.isDisabled(), true, 'a structure repair must clear Forward');

    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.locator('.sidebar .outline-row').filter({ hasText: 'Result details remain available' }).click();
    assert.equal(await back.isEnabled(), true);
    await page.locator('.library-row').filter({ hasText: 'Second library paper' }).click();
    await page.getByRole('heading', { name: 'Second library paper', exact: true }).waitFor();
    assert.equal(await back.isDisabled(), true, 'opening another paper must clear Back');
    assert.equal(await forward.isDisabled(), true, 'opening another paper must clear Forward');
    await page.screenshot({ path: path.join(artifacts, 'reading-history.png') });
    console.log('Reading history checks passed: de-duplicated jumps, Back/Forward, branch clearing, search/scroll/page restoration, stale callback guard, native shortcuts, structure reset and paper isolation.');
  } catch (error) {
    await page?.screenshot({ path: path.join(artifacts, 'reading-history-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app?.close().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
