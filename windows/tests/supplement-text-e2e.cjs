const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { keepMineruResult } = require('../electron/mineru-resources.cjs');
const cases = require('./mac-parity/supplement-text.json');

function sourceBytes({ encoding, text }) {
  if (encoding === 'utf16le') return Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(text, 'utf16le')]);
  if (encoding === 'utf16be') return Buffer.concat([Buffer.from([0xfe,0xff]), Buffer.from(text, 'utf16le').swap16()]);
  return Buffer.concat([encoding === 'utf8bom' ? Buffer.from([0xef,0xbb,0xbf]) : Buffer.alloc(0), Buffer.from(text)]);
}

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'supplement-text-'));
  const originals = path.join(workspace, 'source'), data = path.join(originals, 'data');
  fs.mkdirSync(data, { recursive: true });
  for (const sample of cases) fs.writeFileSync(path.join(data, sample.file), sourceBytes(sample));
  const links = cases.filter(sample => !sample.file.endsWith('.json'));
  const markdown = '# Reference measurements\n\n' + links.map(sample => '[' + sample.file + '](data/' + encodeURIComponent(sample.file) + ')').join('\n\n');
  const document = path.join(originals, 'paper.md');
  fs.writeFileSync(document, markdown);
  const id = createHash('sha256').update(markdown).digest('hex');
  const resource = keepMineruResult(workspace, id, document, markdown);
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown);
  const store = createStore(workspace);
  store.savePaper({ id, name: 'Instrument supplements', type: 'text', sourceMode: 'mineru', mineruMarkdown: markdown,
    mineruResourceId: resource, mineruBlocks: blocks, blocks, position: { tab: 'Paper', displayMode: 'original' } });
  store.markPaperOpened(id);
  store.saveSettings({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1 });
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1420, height: 840 });
    const paperLink = name => page.locator('.document-preview').getByRole('link', { name, exact: true });
    await paperLink(links[0].file).click();
    const dialog = () => page.getByRole('dialog');
    const first = await dialog().locator('pre').textContent();
    console.log(JSON.stringify({ firstDecoded: first === links[0].text, replacementCharacters: [...first].filter(c => c === '�').length }));
    if (process.argv.includes('--observe')) {
      const statuses = await page.evaluate(async ({ id, names }) => {
        const result = [];
        for (const name of names) {
          try {
            const entry = await window.paperBridge.openPaperAttachment(id, 'data/' + encodeURIComponent(name), '');
            result.push([name, entry.kind, entry.content.includes('\u0000'), entry.content.includes('�')]);
          } catch (error) { result.push([name, error.message]); }
        }
        return result;
      }, { id, names: cases.map(sample => sample.file) });
      console.log(JSON.stringify(statuses)); return;
    }
    const nativePath = process.env.PAPERBRIDGE_MAC_REFERENCE;
    const native = nativePath && JSON.parse(fs.readFileSync(nativePath, 'utf8')).supplementText;
    if (nativePath) assert.equal(native?.length, cases.length);
    assert.equal(first, links[0].text);
    await dialog().getByRole('button', { name: 'Close dialog' }).click();
    for (const sample of links) {
      await paperLink(sample.file).click();
      if (sample.file.endsWith('.md')) {
        await dialog().getByRole('heading', { name: '光源协议', exact: true }).waitFor();
        await dialog().getByRole('link', { name: 'calibration data', exact: true }).click();
        const json = cases.find(item => item.file.endsWith('.json'));
        const values = JSON.parse(await dialog().locator('pre').textContent());
        assert.deepEqual(values, JSON.parse(json.text));
        if (native) {
          const mac = native.find(item => item.file === json.file);
          assert.ok(mac.loaded);
          assert.equal(values.wavelength_nm, JSON.parse(mac.text).wavelength_nm);
          assert.equal(native.find(item => item.file === sample.file).text.trim(), sample.text.trim());
        }
        await dialog().getByRole('button', { name: 'Back', exact: true }).click();
        await dialog().getByRole('heading', { name: '光源协议', exact: true }).waitFor();
      } else {
        const text = await dialog().locator('pre').textContent();
        assert.equal(text, sample.text);
        const mac = native?.find(item => item.file === sample.file);
        if (mac?.loaded) assert.equal(text.trim(), mac.text.trim());
      }
      await dialog().getByRole('button', { name: 'Close dialog' }).click();
    }
    await app.close(); app = await launch(); page = await app.firstWindow();
    await paperLink('光源协议.md').click();
    await dialog().getByRole('link', { name: 'calibration data', exact: true }).click();
    assert.equal(JSON.parse(await dialog().locator('pre').textContent()).wavelength_nm, 532);
    await dialog().getByRole('button', { name: 'Close dialog' }).click();
    const exports = path.join(workspace, 'exports');
    fs.mkdirSync(exports);
    await app.evaluate(({ dialog, shell }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
      shell.showItemInFolder = folder => { global.__exportedFolder = folder; };
    }, exports);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await dialog().getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
    await page.getByText(/Exported .*Markdown files/).first().waitFor();
    const exported = await app.evaluate(() => global.__exportedFolder);
    assert.equal(path.dirname(exported), exports);
    const moved = path.join(workspace, 'Moved instrument data');
    fs.renameSync(exported, moved);
    for (const sample of cases) assert.deepEqual(fs.readFileSync(path.join(moved, 'assets', 'source', 'data', sample.file)), sourceBytes(sample));
    console.log(JSON.stringify({ previews: cases.length, movedBundleFiles: cases.length, nativeFiles: native?.filter(item => item.loaded).map(item => item.file) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

