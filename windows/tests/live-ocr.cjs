// Opt-in device test: image-only PDF -> local MinerU OCR -> Reader text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const installMineru = process.env.PAPERBRIDGE_LIVE_INSTALL_MINERU === '1';
  const expectDirectML = process.env.PAPERBRIDGE_LIVE_DIRECTML === '1';
  const toolsRoot = process.env.PAPERBRIDGE_TOOLS_ROOT;
  if (installMineru) {
    assert.ok(toolsRoot && path.isAbsolute(toolsRoot) && !fs.existsSync(toolsRoot), 'One-click testing requires a new absolute PAPERBRIDGE_TOOLS_ROOT');
    assert.ok(!process.env.PAPERBRIDGE_LIVE_MINERU, 'One-click testing must discover its managed installation');
  }
  const model = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const ollamaBaseURL = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';
  fs.mkdirSync(artifacts, { recursive: true });
  const source = path.join(artifacts, 'scanned-ocr-input.pdf');
  const workspace = path.join(artifacts, 'live-ocr-workspace');
  assert.ok(path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep));
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    mineruExecutable: process.env.PAPERBRIDGE_LIVE_MINERU || '', mineruBackend: expectDirectML ? 'auto' : 'pipeline',
    pdfExtractionMode: 'mineruPreferred', autoCheckUpdates: false, onboardingCompletedVersion: 1,
    translationModel: model, ollamaBaseURL, setupComponents: { ollama: false, models: false, mineru: true }
  }));
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    const setupStarted = performance.now();
    if (installMineru) {
      await page.getByRole('button', { name: 'Local AI setup', exact: true }).click();
      await page.getByRole('button', { name: 'Install missing components', exact: true }).click();
      const setupResult = page.locator('.setup-success, .setup-error').first();
      await setupResult.waitFor({ timeout: 600000 });
      assert.equal(await setupResult.getAttribute('class'), 'setup-success', await setupResult.innerText());
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    }
    const setupSeconds = installMineru ? Number(((performance.now() - setupStarted) / 1000).toFixed(1)) : null;
    const configured = process.env.PAPERBRIDGE_LIVE_MINERU || '';
    const detected = await page.evaluate(executable => window.paperBridge.mineruStatus(executable), configured);
    assert.ok(detected.compatible, detected.reason);
    if (expectDirectML) {
      assert.equal(detected.runtime?.directml, true, 'MinerU Auto must select a DirectML adapter');
      assert.ok(detected.runtime.devices.length > 0, 'DirectML detection must identify the adapter');
    }
    if (installMineru) assert.equal(detected.source, 'managed');
    const python = path.join(path.dirname(detected.executable), 'python.exe');
    execFileSync(python, [path.join(__dirname, 'make-scanned-pdf.py'), source]);
    const started = performance.now();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: 'Open PDF' }).first().click();
    await page.waitForFunction(() => /Extracted \d+ blocks|MinerU failed:|No selectable text found/.test(document.body.innerText), null, { timeout: 600000 });
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    const readerText = (await page.locator('.block').allInnerTexts()).join('\n');
    const ocrBlock = page.locator('.reader-list .block').filter({ hasText: 'Researchers measured how a ceramic sample reacted' });
    await ocrBlock.getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
    const translated = ocrBlock.locator('.translation-text.done');
    await translated.waitFor({ timeout: 180000 });
    const translation = await translated.innerText();
    const loadedResponse = await fetch(new URL('/api/ps', ollamaBaseURL), { signal: AbortSignal.timeout(10000) });
    assert.ok(loadedResponse.ok, `Ollama model status failed: ${loadedResponse.status}`);
    const loaded = await loadedResponse.json();
    const active = loaded.models?.find(item => item.name === model || item.model === model);
    assert.ok(active, 'Ollama did not report the translated model as loaded');
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.locator('.scan-notice').getByRole('button', { name: 'Open OCR Reader' }).click();
    await page.getByText('Researchers measured how a ceramic sample reacted', { exact: false }).first().waitFor();
    const fullStarted = performance.now();
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await page.getByText('Structure-preserving full translation saved.', { exact: false }).waitFor({ timeout: 180000 });
    const fullSeconds = Number(((performance.now() - fullStarted) / 1000).toFixed(1));
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    assert.equal(await translated.innerText(), translation, 'Full translation must keep the existing Reader wording');
    const paperFile = fs.readdirSync(path.join(workspace, 'papers')).find(name => name.endsWith('.json'));
    await page.waitForFunction(async id => {
      const saved = await window.paperBridge.loadPaper(id);
      return saved?.connectedShared && saved.blocks.filter(block => !block.resource).every(block => block.status === 'ok');
    }, path.basename(paperFile, '.json'));
    const paper = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', paperFile), 'utf8'));
    assert.ok(paper.connectedTranslation.includes(translation), 'Saved full draft must include the existing Reader translation');
    const report = {
      at: new Date().toISOString(), source, seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
      extraction: paper.extraction, sourceMode: paper.sourceMode,
      pdfBlocks: paper.pdfBlocks?.length || 0, mineruBlocks: paper.mineruBlocks?.length || 0,
      readerCharacters: readerText.length, readerExcerpt: readerText.slice(0, 1200), translation,
      model, modelBytes: active.size, modelVramBytes: active.size_vram,
      autoDetectedMineru: !configured, setupSeconds, mineruVersion: detected.version, mineruRuntime: detected.runtime,
      sharedFullTranslation: paper.connectedShared, fullSeconds
    };
    fs.writeFileSync(path.join(artifacts, 'live-ocr-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    assert.equal(report.pdfBlocks, 0, 'The synthetic scan unexpectedly has selectable text');
    assert.equal(paper.extraction, 'MinerU', 'MinerU OCR did not complete');
    assert.ok(report.mineruBlocks > 0, 'MinerU OCR returned no readable blocks');
    assert.match(readerText, /ceramic|magnetic|calibration/i, 'Reader is missing the scanned text');
    assert.match(translation, /[\u3400-\u9fff]/, 'The OCR text was not translated to Chinese');
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
