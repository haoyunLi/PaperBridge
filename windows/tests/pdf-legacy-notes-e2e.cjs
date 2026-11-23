const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const cases = require('./mac-parity/pdf-note-cases.json');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'pdf-note-recovery-'));
  const pdf = fs.readFileSync(path.join(__dirname, 'mac-parity', 'emcee-v3.pdf'));
  const id = createHash('sha256').update(pdf).digest('hex');
  const blocks = [{ id: 1, text: 'emcee v3', status: 'pending', notes: [], highlights: [] }];
  const paper = { id, type: 'pdf', name: 'emcee v3.pdf', blocks, pdfBlocks: blocks, sourceMode: 'pdf', inspectorOpen: true,
    position: { tab: 'Original', page: 1, block: 1 }, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(dir, 'pdfs')); fs.mkdirSync(path.join(dir, 'papers'));
  const stored = path.join(dir, 'papers', id + '.json');
  fs.writeFileSync(stored, JSON.stringify(paper));
  fs.writeFileSync(path.join(dir, 'pdfs', id + '.pdf'), pdf);
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1,
    autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ ...(exe && { executablePath: exe }), cwd: root,
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')], env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await openWorkspaceView(page, 'Original');
    const first = page.locator('.textLayer[data-page="1"]');
    await first.waitFor();
    const text = await first.textContent();
    assert.ok(text.indexOf('ensemble sampling toolkit') < text.lastIndexOf('ensemble sampling toolkit'));
    await app.close(); app = null;
    const notes = cases.map((item, index) => {
      const offset = item.stored === 'explicitLast' ? text.lastIndexOf(item.quote) : item.stored === 'explicitWrong' ? 1 : 0;
      return { id: item.name, scope: index % 2 ? 'paperPdf' : 'pdf', page: item.page, text: item.quote, kind: 'source', body: 'Test note ' + item.name,
        createdAt: '2026-01-01T00:00:00.000Z', ...(item.stored !== 'missing' && { offset }),
        ...(item.stored.startsWith('explicit') && { anchors: [{ page: item.page, offset, text: item.quote }] }) };
    });
    fs.writeFileSync(stored, JSON.stringify({ ...JSON.parse(fs.readFileSync(stored)), pdfNotes: notes, pdfHighlights: [{ ...notes[0], id: 'gold', color: 'amber', body: undefined }] }));
    app = await launch(); page = await app.firstWindow();
    await page.getByRole('heading', { name: paper.name, exact: true }).waitFor();
    const observed = {};
    for (const item of cases) {
      const row = page.locator('.annotation-row').filter({ hasText: 'Test note ' + item.name });
      await row.getByRole('button').first().click();
      const deadline = Date.now() + 7000;
      let resolved = false, needsReview = false;
      do {
        const record = JSON.parse(fs.readFileSync(stored)).pdfNotes.find(note => note.id === item.name);
        needsReview = record.needsReview === true;
        resolved = await page.getByLabel('Note for selected passage').count() > 0
          && await page.getByLabel('Note for selected passage').inputValue() === record.body
          && await page.evaluate(() => window.getSelection()?.toString()) === item.quote;
        if (!resolved && !needsReview) await new Promise(resolve => setTimeout(resolve, 60));
      } while (Date.now() < deadline && !resolved && !needsReview);
      assert.ok(resolved || needsReview, 'Expected a navigation decision for ' + item.name);
      observed[item.name] = resolved;
    }
    const native = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE)).pdfNotes;
    console.log(JSON.stringify({ dir, observed, comparedWithMac: Boolean(native) }));
    assert.deepEqual(observed, Object.fromEntries(cases.map(item => [item.name, item.expect])));
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) assert.deepEqual(observed, native, 'The same six saved notes must resolve as in PDFKit');
    let saved = JSON.parse(fs.readFileSync(stored));
    assert.equal(saved.pdfNotes.length, notes.length);
    for (const note of saved.pdfNotes) {
      assert.equal(note.body, notes.find(original => original.id === note.id).body);
      assert.equal(note.createdAt, notes[0].createdAt);
    }
    assert.deepEqual(saved.pdfNotes[0].anchors, [{ page: 1, offset: text.indexOf(cases[0].quote), text: cases[0].quote }]);
    assert.deepEqual(saved.pdfHighlights[0].anchors, saved.pdfNotes[0].anchors);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.locator('.annotation-row').filter({ hasText: 'Test note unique' }).getByRole('button').first().click();
    await page.waitForFunction(quote => window.getSelection()?.toString() === quote, cases[0].quote);
    assert.equal(await page.getByLabel('Note for selected passage').inputValue(), 'Test note unique');
    saved = JSON.parse(fs.readFileSync(stored)); assert.ok(saved.pdfNotes.find(note => note.id === 'repeated').needsReview);
  } finally { await app?.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
