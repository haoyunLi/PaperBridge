// Compare the two columns with PDFKit's page text and keep numerical table rows out of the translation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), source = path.resolve(process.argv[2]);
  const native = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const id = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  assert.equal(id, '1e0651b6810ecba34a3dbc5b5b0209226f889004607c1f203540a48d64e5a93a');
  const directory = fs.mkdtempSync(path.join(root, 'test-artifacts', 'resnet-column-'));
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ ...defaults, pdfExtractionMode: 'pdfOnly',
    onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(directory, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: directory } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByText(/Extracted \d+ blocks from 12 pages/).first().waitFor({ timeout: 60000 });
    const { blocks } = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
    const join = native.leftEnd.replace(/-$/, '') + native.rightBody;
    const paragraph = blocks.find(b => b.text.includes(join));
    assert.ok(paragraph && paragraph.page === 12 && !paragraph.endPage);
    assert.equal(blocks.filter(b => b.page === 12 && b.text === native.caption).length, 1);
    assert.equal(blocks.filter(b => b.page === 12 && b.text === native.finalTableRow).length, 1);
    assert.doesNotMatch(paragraph.text, /OverFeat|GoogLeNet|Table 14\./);
    await openWorkspaceView(page, 'Reader');
    let row = page.locator('#block-' + paragraph.id);
    await row.getByText(join, { exact: false }).first().waitFor();
    const report = { directory, block: paragraph.id, printedJoin: join };
    if (process.argv.includes('--live')) {
      await row.getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
      const result = row.locator('.translation-text.done');
      await result.waitFor({ timeout: 150000 });
      report.translation = await result.innerText();
      for (const value of ['VGG', '33.1%', '13.3%', '11.7%', '14.4%']) assert.ok(report.translation.includes(value), value);
      assert.doesNotMatch(report.translation, /GoogLeNet|OverFeat/);
      const running = await (await fetch('http://127.0.0.1:11434/api/ps')).json();
      report.vram = running.models.find(m => m.name === 'translategemma:4b')?.size_vram;
      assert.ok(report.vram > 0);
      await app.close(); app = await launch(); page = await app.firstWindow();
      await openWorkspaceView(page, 'Reader'); row = page.locator('#block-' + paragraph.id);
      assert.equal(await row.locator('.translation-text.done').innerText(), report.translation);
    }
    if (process.argv.includes('--colors')) {
      const chart = require('./mac-paper-layout/resnet-figure.json');
      assert.equal(native.figure3?.length, chart.points.length);
      await openWorkspaceView(page, 'Original');
      const host = page.locator('.pdf-continuous');
      await host.focus(); await host.press('Control+Home');
      await page.locator('.pdf-toolbar').getByText('Exact original PDF · page 1 of 12').waitFor();
      for (let number = 2; number <= chart.page; number++) {
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await page.locator('.pdf-toolbar').getByText('Exact original PDF · page ' + number + ' of 12').waitFor();
      }
      const slot = page.locator('[data-pdf-page="' + chart.page + '"]');
      await slot.locator('.textLayer[data-page="' + chart.page + '"]').waitFor();
      report.figure3 = await slot.locator('canvas').evaluate((canvas, chart) => {
        const ctx = canvas.getContext('2d');
        return chart.points.map(([x, y]) => Array.from(ctx.getImageData(Math.floor(x / chart.width * canvas.width),
          Math.floor(y / chart.height * canvas.height), 1, 1).data).slice(0, 3));
      }, chart);
      console.log(JSON.stringify({ sampled: report.figure3, native: native.figure3 }));
      report.figure3.forEach((rgb, i) => {
        assert.ok(Math.max(...rgb) - Math.min(...rgb) >= 8, 'Printed residual-network layer fill ' + i);
        assert.ok(rgb.every((v, j) => Math.abs(v - native.figure3[i][j]) <= 3), 'Layer color matches native PDFKit');
      });
    }
    console.log(JSON.stringify(report));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
