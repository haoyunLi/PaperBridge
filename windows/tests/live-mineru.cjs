// Explicit device test. Supply PAPERBRIDGE_LIVE_PDF with a real paper PDF.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const source = path.resolve(process.env.PAPERBRIDGE_LIVE_PDF || path.join(artifacts, 'attention-is-all-you-need.pdf'));
  const mineru = process.env.PAPERBRIDGE_LIVE_MINERU || path.join(process.env.LOCALAPPDATA || '', 'PaperBridge', 'tools', 'mineru', 'Scripts', 'mineru.exe');
  assert.ok(fs.existsSync(source), `PDF not found: ${source}`);
  assert.ok(fs.existsSync(mineru), `MinerU not found: ${mineru}`);
  const workspace = path.join(artifacts, 'live-mineru-workspace');
  assert.ok(path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep));
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    mineruExecutable: mineru, mineruBackend: 'pipeline', pdfExtractionMode: 'mineruPreferred', autoCheckUpdates: false
  }));
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  const started = performance.now();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: 'Open PDF' }).first().click();
    await page.waitForFunction(() => /Extracted \d+ blocks|MinerU failed:|No selectable text found/.test(document.body.innerText), null, { timeout: 600000 });
    const status = await page.locator('.main-scroll').innerText();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    const readerText = (await page.locator('.block').allInnerTexts()).join('\n');
    await page.screenshot({ path: path.join(artifacts, 'live-mineru-reader.png') });
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500, null, { timeout: 20000 });
    await page.screenshot({ path: path.join(artifacts, 'live-mineru-original.png') });
    const paperFile = fs.readdirSync(path.join(workspace, 'papers')).find(name => name.endsWith('.json'));
    const paper = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', paperFile), 'utf8'));
    const report = {
      at: new Date().toISOString(), source, seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
      extraction: paper.extraction, sourceMode: paper.sourceMode, blocks: paper.blocks.length,
      pdfBlocks: paper.pdfBlocks?.length, mineruBlocks: paper.mineruBlocks?.length || 0,
      markdownCharacters: paper.mineruMarkdown?.length || 0,
      firstBlocks: paper.blocks.slice(0, 8).map(block => ({ text: block.text?.slice(0, 220), heading: block.heading, resource: block.resource })),
      readerCharacters: readerText.length, status: status.slice(0, 500)
    };
    fs.writeFileSync(path.join(artifacts, 'live-mineru-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    assert.equal(paper.extraction, 'MinerU', 'MinerU did not complete; inspect the fallback reason above');
    assert.ok(paper.blocks.length > 20, 'Unexpectedly few blocks');
    assert.ok(readerText.length > 1000, 'Reader has little extracted text');
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
