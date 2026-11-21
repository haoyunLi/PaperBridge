const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');

async function run() {
  const { savedPDFJournal, comparePDFJournalEditions } = await import('./mac-parity/pdf-journal.mjs');
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'test-artifacts'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'test-artifacts', 'journal-pdf-export-'));
  const pdf = path.join(__dirname, 'mac-parity', 'good-enough', 'article.pdf');
  const original = fs.readFileSync(pdf);
  const reference = process.env.PAPERBRIDGE_MAC_REFERENCE
    ? JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).pdfJournal : null;
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1,
    pdfExtractionMode: 'pdfOnly', autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const open = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, PAPERBRIDGE_WORKSPACE: dir, NODE_ENV: 'production' } });
  const id = savedPDFJournal().id;
  const stored = path.join(dir, 'papers', id + '.json');
  const read = () => JSON.parse(fs.readFileSync(stored, 'utf8'));
  let app = await open();
  try {
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, pdf);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: 'article.pdf', exact: true }).waitFor({ timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.task-progress'));
    await app.close(); app = null;
    const imported = read();
    assert.equal(imported.sourceMode, 'pdf');
    assert.ok(imported.blocks.some(b => b.text.includes('Good enough practices in scientific computing')));
    assert.equal(new Set(imported.blocks.map(b => b.page)).size, 20);
    const firstPage = imported.blocks.filter(b => b.page === 1).map(b => b.text);
    const overview = firstPage.indexOf('Overview');
    assert.ok(overview > firstPage.findIndex(text => text.startsWith('Competing interests:')));
    for (const label of ['Citation:', 'Editor:', 'Published:', 'Copyright:', 'Funding:', 'Competing interests:']) {
      assert.ok(firstPage.slice(0, overview).some(text => text.includes(label)), 'Missing editorial label ' + label);
    }
    assert.match(firstPage[overview + 1], /^We present a set.*people who are new to research computing\.$/);
    assert.equal(firstPage[overview + 2], 'Introduction');
    assert.match(firstPage[overview + 3], /^Three years ago, a group of researchers/);
    assert.ok(firstPage.includes('Greg Wilson1☯*, Jennifer Bryan2☯, Karen Cranston3☯, Justin Kitzes4☯, Lex Nederbragt5☯, Tracy K. Teal6☯'));
    assert.ok(firstPage.every(text => !text.includes('a1111111111') && !text.includes('PLOS Computational Biology |')));
    if (reference) {
      assert.ok(reference.nativeSource.includes('Overview\n' + firstPage[overview + 1]));
    }

    for (const state of ['complete', 'partial']) {
      const snapshot = savedPDFJournal(state === 'partial');
      const noted = snapshot.blocks.find(b => b.id === 75);
      noted.bookmark = true;
      noted.notes = [{ id: 'text-editor', kind: 'source', text: 'modern text editors', offset: noted.text.indexOf('modern text editors'), body: 'Compare editor support.' }];
      const paper = { ...imported, ...snapshot, pdfBlocks: snapshot.blocks };
      fs.writeFileSync(stored, JSON.stringify(paper));
      app = await open(); page = await app.firstWindow();
      await page.getByRole('heading', { name: paper.name, exact: true }).waitFor();
      const out = path.join(dir, state);
      fs.mkdirSync(out);
      await app.evaluate(({ dialog, shell }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
        shell.showItemInFolder = () => {};
      }, out);
      await page.getByRole('button', { name: 'More ···', exact: true }).click();
      await page.locator('.modal').getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
      await page.getByText(/Exported .*original PDF to /).waitFor({ timeout: 90000 });
      const folder = path.join(out, 'Good enough practices in scientific computing_PaperBridge');
      assert.deepEqual(fs.readFileSync(path.join(folder, 'original.pdf')), original);
      function body(file, title) {
        const markdown = fs.readFileSync(path.join(folder, file), 'utf8');
        const boundary = '\n---\n\n# ' + title + '\n\n';
        const pos = markdown.indexOf(boundary);
        assert.ok(pos > 0, 'Missing heading ' + title + ' in ' + file);
        const pages = [...markdown.slice(0, pos).matchAll(/!\[Original PDF page (\d+)\]\((pages\/page-\d+\.png)\)/g)];
        assert.deepEqual(pages.map(m => Number(m[1])), Array.from({ length: 20 }, (_, i) => i + 1));
        for (const [, , image] of pages) {
          const png = fs.readFileSync(path.join(folder, image));
          assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          assert.ok(png.readUInt32BE(16) > 400 && png.readUInt32BE(20) > 400);
        }
        return markdown.slice(pos + boundary.length);
      }
      const translated = body('paper_translation_zh-Hans.md', 'Simplified Chinese translation of selectable text');
      const bilingual = body('paper_bilingual_en_zh-Hans.md', 'Extracted bilingual text');
      assert.ok(bilingual.includes('Compare editor support.') && bilingual.includes('## Bookmarks'));
      const expected = state === 'complete' ? noted.translation : noted.text;
      assert.ok(translated.includes(expected));
      if (reference) comparePDFJournalEditions(paper, reference[state], translated, bilingual);
      await app.close(); app = null;
    }
    console.log(JSON.stringify({ dir, pages: 20, translatedParagraphs: 208, comparedWithMac: Boolean(reference) }));
  } finally { if (app) await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
