const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'export-names-'));
  const out = path.join(dir, 'exported');
  fs.mkdirSync(out);
  const lead = 'Optical calibration of the cryogenic reference detector'.padEnd(55) + '👩‍🔬';
  const title = (lead + ' under repeated irradiation').padEnd(89) + '🔬：三次独立复测后的参考谱线与误差分析 – laboratory results and reference observations';
  const pdf = path.join(dir, title + '.pdf');
  const source = fs.readFileSync(path.join(__dirname, 'mac-parity', 'mixed-cid-record.pdf'));
  fs.writeFileSync(pdf, source);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1,
    pdfExtractionMode: 'pdfOnly', autoCheckUpdates: false, translationModel: 'translategemma:4b' }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  try {
    const observe = process.argv.includes('--observe');
    await app.evaluate(({ dialog }, { pdf, out, observe }) => {
      const path = process.getBuiltinModule('path');
      const fs = process.getBuiltinModule('fs');
      globalThis.exportNames = [];
      dialog.showOpenDialog = async (_owner, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? out : pdf] });
      dialog.showSaveDialog = async (_owner, { defaultPath }) => {
        const name = path.basename(defaultPath);
        globalThis.exportNames.push(name);
        const target = path.join(out, name);
        if (observe || fs.existsSync(target)) return { canceled: true };
        return { canceled: false, filePath: target };
      };
    }, { pdf, out, observe });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: title + '.pdf', exact: true }).waitFor();
    await openWorkspaceView(page, 'Reader');
    const block = page.locator('.reader-list article').filter({ hasText: 'The reference signal remained constant.' });
    await block.getByRole('button', { name: 'Bookmark', exact: true }).click();
    let liveTranslation;
    if (process.argv.includes('--live')) {
      await block.getByRole('button', { name: 'Paragraph actions' }).click();
      await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
      const translated = block.locator('.translation-text.done');
      await translated.waitFor({ timeout: 150000 });
      liveTranslation = await translated.innerText();
      assert.match(liveTranslation, /[\p{Script=Han}]/u);
    }
    const exportOption = async label => {
      await page.getByRole('button', { name: 'More ···', exact: true }).click();
      await page.getByRole('button', { name: 'Export Options…', exact: true }).click();
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator('.modal').waitFor({ state: 'detached' });
    };
    for (const label of ['Original Markdown', 'Translated Markdown', 'Bilingual Markdown', 'Summary, sources and notes']) {
      await exportOption(label);
    }
    const names = await app.evaluate(() => globalThis.exportNames);
    console.log(JSON.stringify({ unique: new Set(names).size, names }));
    if (observe) return;
    assert.equal(new Set(names).size, 4);
    for (const name of names) {
      assert.ok(name.isWellFormed() && !name.includes('�'));
      assert.ok(name.length <= 94);
    }
    const suffixes = ['_original.md', '_translation_zh-Hans.md', '_bilingual_en_zh-Hans.md', '_bilingual.md'];
    assert.ok(names.every((name, index) => name.endsWith(suffixes[index])));
    const files = names.map(name => fs.readFileSync(path.join(out, name), 'utf8'));
    assert.ok(files[3].includes('Bookmarked in PaperBridge'));
    assert.match(files[0], /参考|校准/);
    assert.ok(files[1].includes('Untranslated block'));
    assert.ok(files[2].includes('Not translated'));
    if (liveTranslation) {
      assert.ok(files[1].includes(liveTranslation) && files[2].includes(liveTranslation) && files[3].includes(liveTranslation));
      assert.ok(!files[0].includes(liveTranslation));
      console.log(JSON.stringify({ liveTranslation }));
    }
    await exportOption('Export portable Markdown bundle');
    const folder = fs.readdirSync(out, { withFileTypes: true }).find(entry => entry.isDirectory());
    assert.ok(folder?.name.endsWith('_PaperBridge') && folder.name.isWellFormed());
    await page.waitForFunction(() => !document.querySelector('.task-progress'));
    assert.deepEqual(fs.readFileSync(path.join(out, folder.name, 'original.pdf')), source);
    console.log('Saved each reading edition separately, preserved the bookmark in the notes edition, and exported the original bytes inside the named bundle.');
    // The user can type a longer name than the suggested one in the native Save dialog.
    const chosenDirectory = fs.mkdtempSync(path.join(dir, 'save-as-'));
    const chosenName = '測'.repeat(248) + '🧪.md';
    const chosen = path.join(chosenDirectory, chosenName);
    const originalExport = Buffer.from('# Laboratory notebook\r\n\r\n研究員の手書き追記。\r\n', 'utf8');
    fs.writeFileSync(chosen, originalExport);
    await app.evaluate(({ dialog }, target) => {
      const fs = process.getBuiltinModule('fs');
      const path = process.getBuiltinModule('path');
      const open = fs.openSync;
      const write = fs.writeFileSync;
      let outputDescriptor;
      fs.openSync = function (file, ...args) {
        const descriptor = open.call(this, file, ...args);
        if (typeof file === 'string' && path.dirname(file) === path.dirname(target)) outputDescriptor = descriptor;
        return descriptor;
      };
      fs.writeFileSync = function (file, ...args) {
        if (file !== target && (outputDescriptor === undefined || file !== outputDescriptor)) return write.call(this, file, ...args);
        fs.openSync = open;
        fs.writeFileSync = write;
        write.call(this, file, Buffer.from('Incomplete Markdown'));
        throw Object.assign(new Error('Export test volume is full'), { code: 'ENOSPC' });
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, chosen);
    await exportOption('Original Markdown');
    const observeInterruption = process.argv.includes('--observe-interrupted');
    await page.getByText(observeInterruption ? /Export test volume is full/ : /There is not enough free space to export the Markdown file/).waitFor();
    const preserved = fs.readFileSync(chosen).equals(originalExport);
    console.log(JSON.stringify({ interruptedExportPreserved: preserved, filenameUnits: chosenName.length }));
    if (observeInterruption) return;
    assert.ok(preserved, 'An interrupted export preserves the previous file byte for byte');
    assert.deepEqual(fs.readdirSync(chosenDirectory), [chosenName]);
    if (process.platform === 'win32') {
      fs.chmodSync(chosen, 0o444);
      try {
        await exportOption('Original Markdown');
        await page.getByText(/Windows could not save the Markdown file/).waitFor();
        assert.deepEqual(fs.readFileSync(chosen), originalExport);
        assert.deepEqual(fs.readdirSync(chosenDirectory), [chosenName]);
      } finally { fs.chmodSync(chosen, 0o666); }
    }
    await exportOption('Original Markdown');
    await page.waitForFunction(() => !document.querySelector('.task-progress'));
    assert.deepEqual(fs.readFileSync(chosen), Buffer.from(files[0]));
    assert.deepEqual(fs.readdirSync(chosenDirectory), [chosenName]);
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
