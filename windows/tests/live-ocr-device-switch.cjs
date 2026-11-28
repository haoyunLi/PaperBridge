// Compare both Windows ONNX device choices against the same archived Group 4 scan.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults, createStore } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  const file = path.join(__dirname, 'mac-parity', 'fax-calibration.pdf');
  const original = fs.readFileSync(file), id = createHash('sha256').update(original).digest('hex');
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE, mineru = process.env.PAPERBRIDGE_LIVE_MINERU;
  assert.ok(exe && mineru, 'Supply a packaged reader and a real MinerU installation');
  fs.mkdirSync(artifacts, { recursive: true });
  const texts = [];
  for (const backend of ['auto', 'pipeline']) {
    const dir = fs.mkdtempSync(path.join(artifacts, 'ocr-backend-' + backend + '-'));
    const store = createStore(dir);
    store.saveSettings({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1, pdfExtractionMode: 'mineruOnly',
      mineruExecutable: mineru, mineruBackend: 'auto' });
    const launch = () => electron.launch({ executablePath: exe, cwd: root, args: ['--user-data-dir=' + path.join(dir, 'profile')],
      env: { ...process.env, PAPERBRIDGE_WORKSPACE: dir } });
    let app = await launch();
    try {
      let page = await app.firstWindow();
      await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
      await page.getByRole('tab', { name: 'Parsing', exact: true }).click();
      await page.getByLabel('MinerU backend', { exact: true }).selectOption(backend);
      const expected = backend === 'auto' ? /Auto selects DirectML on AMD Radeon/i : /compatibility mode uses CPU/i;
      const device = page.getByRole('status').filter({ hasText: expected });
      await device.waitFor({ timeout: 60000 });
      const description = await device.innerText();
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await app.close(); app = await launch(); page = await app.firstWindow();
      assert.equal(await page.evaluate(async () => (await window.paperBridge.bootstrap()).settings.mineruBackend), backend);
      await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, file);
      const start = Date.now();
      await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
      await page.waitForFunction(id => document.querySelector('.main-scroll')?.dataset.readingPaperId === id &&
        !document.querySelector('.task-progress'), id, { timeout: 150000 });
      await openWorkspaceView(page, 'Reader');
      const paper = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
      assert.equal(paper.extraction, 'MinerU');
      assert.deepEqual(original, fs.readFileSync(store.pdfPath(id)));
      const text = paper.blocks.map(block => block.text).join('\n');
      console.log(JSON.stringify({ backend, description, elapsedMs: Date.now() - start, blocks: paper.blocks.length, text }));
      assert.match(text, /532\s*nm/i);
      texts.push(text);
    } finally { await app.close(); }
  }
  console.log(JSON.stringify({ exactTextMatch: texts[0] === texts[1] }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
