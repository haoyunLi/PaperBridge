// Explicit device test. Supply PAPERBRIDGE_LIVE_PDF with a real paper PDF.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const source = path.resolve(process.env.PAPERBRIDGE_LIVE_PDF || path.join(artifacts, 'attention-is-all-you-need.pdf'));
  const mineru = process.env.PAPERBRIDGE_LIVE_MINERU || path.join(process.env.LOCALAPPDATA || '', 'PaperBridge', 'tools', 'mineru', 'Scripts', 'mineru.exe');
  const expectDirectML = process.env.PAPERBRIDGE_LIVE_DIRECTML === '1';
  assert.ok(fs.existsSync(source), `PDF not found: ${source}`);
  assert.ok(fs.existsSync(mineru), `MinerU not found: ${mineru}`);
  const longPaths = process.env.PAPERBRIDGE_LIVE_LONG_PATHS === '1';
  const name = (expectDirectML ? 'live-mineru-directml' : 'live-mineru') + (longPaths ? '-long-paths' : '');
  const workspace = path.join(artifacts, `${name}-workspace`);
  assert.ok(path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep));
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    mineruExecutable: mineru, mineruBackend: expectDirectML ? 'auto' : 'pipeline', pdfExtractionMode: 'mineruPreferred', autoCheckUpdates: false, onboardingCompletedVersion: 1
  }));
  const env = { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace };
  if (longPaths) {
    assert.equal(process.platform, 'win32', 'The extended path test requires Windows');
    let temp = path.join(artifacts, 'mineru-path-test');
    while (temp.length <= 260) temp = path.join(temp, '期刊 PDF temporary files');
    fs.mkdirSync(temp, { recursive: true });
    env.TEMP = temp;
    env.TMP = temp;
    env.PAPERBRIDGE_TOOLS_ROOT = path.join(temp, 'tools');
  }
  const app = await electron.launch({ args: ['.'], cwd: root, env, timeout: 30000 });
  const started = performance.now();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    const detected = await page.evaluate(executable => window.paperBridge.mineruStatus(executable), mineru);
    assert.ok(detected.compatible, detected.reason);
    if (expectDirectML) assert.equal(detected.runtime?.directml, true, 'MinerU Auto must select DirectML');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: 'Open PDF' }).first().click();
    const id = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    await page.waitForFunction(id => {
      const host = document.querySelector('.main-scroll');
      return document.querySelector('.notice.error') || (host?.dataset.readingPaperId === id && host.getAttribute('aria-busy') === 'false');
    }, id, { timeout: 600000 });
    assert.deepEqual(await page.locator('.notice.error').allTextContents(), []);
    const status = await page.locator('.main-scroll').innerText();
    await openWorkspaceView(page, 'Reader');
    await page.locator('.block').first().waitFor();
    const readerText = (await page.locator('.block').allInnerTexts()).join('\n');
    await page.screenshot({ path: path.join(artifacts, `${name}-reader.png`) });
    await openWorkspaceView(page, 'Original');
    await page.waitForFunction(() => document.querySelector('.pdf-sheet canvas')?.width > 500, null, { timeout: 20000 });
    await page.screenshot({ path: path.join(artifacts, `${name}-original.png`) });
    const paperFile = fs.readdirSync(path.join(workspace, 'papers')).find(name => name.endsWith('.json'));
    const paper = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', paperFile), 'utf8'));
    const report = {
      at: new Date().toISOString(), source, ...(longPaths && { temporaryPathLength: env.TEMP.length, toolsPathLength: env.PAPERBRIDGE_TOOLS_ROOT.length }), seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
      extraction: paper.extraction, sourceMode: paper.sourceMode, blocks: paper.blocks.length,
      pdfBlocks: paper.pdfBlocks?.length, mineruBlocks: paper.mineruBlocks?.length || 0,
      mineruVersion: detected.version, mineruRuntime: detected.runtime,
      markdownCharacters: paper.mineruMarkdown?.length || 0,
      firstBlocks: paper.blocks.slice(0, 8).map(block => ({ text: block.text?.slice(0, 220), heading: block.heading, resource: block.resource })),
      readerCharacters: readerText.length, status: status.slice(0, 500)
    };
    fs.writeFileSync(path.join(artifacts, `${name}-report.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    assert.equal(paper.extraction, 'MinerU', 'MinerU did not complete; inspect the fallback reason above');
    assert.ok(paper.blocks.length > 20, 'Unexpectedly few blocks');
    assert.ok(readerText.length > 1000, 'Reader has little extracted text');
    if (longPaths) assert.deepEqual(fs.readdirSync(env.TEMP).filter(name => name.startsWith('paperbridge-mineru-')), [],
      'The parser staging directory was removed after the long-path import');
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
