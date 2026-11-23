// Run with the original ACL proceedings PDF and its independent PDFKit report.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  const source = path.resolve(process.argv[2]), native = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const id = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  assert.equal(id, '987545ffb087f1ece898142c403a516baeabeb70ce19089397fac6f7db12c3d4');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'proceedings-reader-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, pdfExtractionMode: 'pdfOnly',
    onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByText(/Extracted \d+ blocks from 16 pages/).first().waitFor({ timeout: 60000 });
    const paper = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    const blocks = paper.blocks;
    assert.equal(Math.max(...blocks.map(b => b.endPage || b.page)), native.pages);
    assert.equal(blocks[0].text, native.title);
    assert.equal(blocks[1].text, native.byline);
    const notice = blocks.find(b => b.text.startsWith(native.notice.split(' pages')[0]));
    assert.ok(notice.text.includes('©2019 Association for Computational Linguistics'));
    assert.ok(notice.id < blocks.find(b => b.text === 'Abstract').id);
    const join = native.lastBodyLine + ' ' + native.firstBodyLine;
    const paragraph = blocks.find(b => b.text.includes(join));
    assert.ok(paragraph && paragraph.page === 1 && paragraph.endPage === 2);
    assert.ok(!paragraph.text.includes('Proceedings'));
    assert.equal(blocks.find(b => b.pdfFootnoteMarker === '8').text, '8See (10) in https://gluebenchmark.com/faq.');
    await openWorkspaceView(page, 'Reader');
    const row = page.locator('#block-' + paragraph.id);
    await row.getByText(join, { exact: false }).first().waitFor();
    const report = { workspace: dir, title: blocks[0].id, byline: blocks[1].id, notice: notice.id, paragraph: paragraph.id };
    let figureBody;
    if (native.afterFigure && native.beforeFigurePage && native.captionEnd) {
      const figureJoin = native.beforeFigurePage.replace(/-$/, '') + native.afterFigure;
      figureBody = blocks.find(block => block.text.includes(figureJoin));
      assert.ok(figureBody && figureBody.page === 2 && figureBody.endPage === 3);
      const caption = blocks.find(block => block.page === 3 && block.text.startsWith('Figure 1:'));
      assert.ok(caption && caption.text.endsWith(native.captionEnd));
      assert.ok(blocks.some(block => block.page === 3 && block.text === 'Pre-training Fine-Tuning'));
      assert.doesNotMatch(figureBody.text, /Overall pre-training|questions\/answers/);
      await page.locator('#block-' + figureBody.id).getByText(figureJoin, { exact: false }).first().waitFor();
      report.figureContinuation = figureBody.id;
      report.figureCaption = caption.id;
    }
    let columns;
    if (native.leftColumnEnd && native.rightColumnStart) {
      const word = native.leftColumnEnd.replace(/-$/, '') + native.rightColumnStart.replace(/-$/, '');
      columns = blocks.find(b => b.page === 3 && b.text.includes(word));
      assert.ok(columns && !columns.endPage);
      await page.locator('#block-' + columns.id).getByText(word, { exact: false }).first().waitFor();
      report.columnContinuation = columns.id;
    }
    if (process.argv.includes('--live')) {
      await row.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
      const translated = row.locator('.translation-text.done');
      await translated.waitFor({ timeout: 150000 });
      report.translation = await translated.innerText();
      assert.match(report.translation, /MLM|掩[码蔽膜]|屏蔽|遮[蔽罩]/);
      assert.ok(!/NAACL|计算语言学协会|明尼[苏索]/i.test(report.translation));
      if (figureBody) {
        const continuation = page.locator('#block-' + figureBody.id);
        await continuation.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
        const result = continuation.locator('.translation-text.done');
        await result.waitFor({ timeout: 150000 });
        report.figureBodyTranslation = await result.innerText();
        assert.match(report.figureBodyTranslation, /左(?:向|到|至)右/);
        assert.doesNotMatch(report.figureBodyTranslation, /分隔符|特殊标记|问题[和与]答案/);
      }
      if (columns) {
        const row = page.locator('#block-' + columns.id);
        await row.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
        const result = row.locator('.translation-text.done');
        await result.waitFor({ timeout: 150000 });
        report.columnTranslation = await result.innerText();
        assert.match(report.columnTranslation, /预训练/);
        assert.match(report.columnTranslation, /下游/);
      }
      const running = await (await fetch('http://127.0.0.1:11434/api/ps')).json();
      report.vram = running.models.find(m => m.name === 'translategemma:4b')?.size_vram;
      assert.ok(report.vram > 0);
      await app.close(); app = await launch(); page = await app.firstWindow();
      await openWorkspaceView(page, 'Reader');
      assert.equal(await page.locator('#block-' + paragraph.id + ' .translation-text.done').innerText(), report.translation);
      if (figureBody) assert.equal(await page.locator('#block-' + figureBody.id + ' .translation-text.done').innerText(), report.figureBodyTranslation);
      if (columns) assert.equal(await page.locator('#block-' + columns.id + ' .translation-text.done').innerText(), report.columnTranslation);
    }
    console.log(JSON.stringify(report));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
