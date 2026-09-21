// Opt-in device test: image-only PDF -> local MinerU OCR -> Reader text.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const mineru = process.env.PAPERBRIDGE_LIVE_MINERU || path.join(process.env.LOCALAPPDATA || '', 'PaperBridge', 'tools', 'mineru', 'Scripts', 'mineru.exe');
  const python = path.join(path.dirname(mineru), 'python.exe');
  assert.ok(fs.existsSync(mineru), `MinerU not found: ${mineru}`);
  assert.ok(fs.existsSync(python), `Managed Python not found: ${python}`);
  const model = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const ollamaBaseURL = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';
  fs.mkdirSync(artifacts, { recursive: true });
  const source = path.join(artifacts, 'scanned-ocr-input.pdf');
  execFileSync(python, [path.join(__dirname, 'make-scanned-pdf.py'), source]);
  const workspace = path.join(artifacts, 'live-ocr-workspace');
  assert.ok(path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep));
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    mineruExecutable: mineru, mineruBackend: 'pipeline', pdfExtractionMode: 'mineruPreferred', autoCheckUpdates: false,
    translationModel: model, ollamaBaseURL
  }));
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  const started = performance.now();
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await page.getByRole('button', { name: 'Open PDF' }).first().click();
    await page.waitForFunction(() => /Extracted \d+ blocks|MinerU failed:|No selectable text found/.test(document.body.innerText), null, { timeout: 600000 });
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    const readerText = (await page.locator('.block').allInnerTexts()).join('\n');
    await page.locator('#block-3 button[title="Translate or retry block"]').click();
    await page.locator('#block-3 .translation-text.done').waitFor({ timeout: 180000 });
    const translation = await page.locator('#block-3 .translation-text.done').innerText();
    const loadedResponse = await fetch(new URL('/api/ps', ollamaBaseURL), { signal: AbortSignal.timeout(10000) });
    assert.ok(loadedResponse.ok, `Ollama model status failed: ${loadedResponse.status}`);
    const loaded = await loadedResponse.json();
    const active = loaded.models?.find(item => item.name === model || item.model === model);
    assert.ok(active, 'Ollama did not report the translated model as loaded');
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.locator('.scan-notice').getByRole('button', { name: 'Open OCR Reader' }).click();
    await page.getByText('Researchers measured how a ceramic sample reacted', { exact: false }).first().waitFor();
    const paperFile = fs.readdirSync(path.join(workspace, 'papers')).find(name => name.endsWith('.json'));
    const paper = JSON.parse(fs.readFileSync(path.join(workspace, 'papers', paperFile), 'utf8'));
    const report = {
      at: new Date().toISOString(), source, seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
      extraction: paper.extraction, sourceMode: paper.sourceMode,
      pdfBlocks: paper.pdfBlocks?.length || 0, mineruBlocks: paper.mineruBlocks?.length || 0,
      readerCharacters: readerText.length, readerExcerpt: readerText.slice(0, 1200), translation,
      model, modelBytes: active.size, modelVramBytes: active.size_vram
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
