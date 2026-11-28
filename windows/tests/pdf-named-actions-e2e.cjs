const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'pdf-named-actions-'));
  const source = path.join(__dirname, 'mac-parity', 'maintenance-navigation.pdf');
  const id = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  createStore(workspace).saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly' });
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ cwd: root, ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  try {
    const page = await app.firstWindow(); await page.setViewportSize({ width: 1390, height: 820 });
    await app.evaluate(({ dialog, shell }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); global.__outgoing = [];
      shell.openExternal = async url => { global.__outgoing.push(url); };
    }, source);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: path.basename(source), exact: true }).waitFor();
    await openWorkspaceView(page, 'Original');
    const toolbar = n => page.getByText('Exact original PDF · page ' + n + ' of 4', { exact: true });
    const printed = (n, label) => page.locator('.textLayer[data-page="' + n + '"]').getByText(label, { exact: true });
    await toolbar(1).waitFor();
    const lines = ['Calibration reference', 'Record the room temperature here.', 'and data appendix'];
    const hits = [];
    for (const label of lines) {
      const previous = await app.evaluate(() => global.__outgoing.length);
      await printed(1, label).click();
      hits.push((await app.evaluate(() => global.__outgoing.length)) > previous);
    }
    const reference = process.env.PAPERBRIDGE_MAC_REFERENCE && JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE)).namedPdfActions;
    if (process.env.PAPERBRIDGE_MAC_REFERENCE && !process.argv.includes('--observe')) assert.equal(reference.sha256, id);
    const steps = [];
    const expected = reference?.steps || [
      {from:1,label:'Next record',page:2}, {from:2,label:'Last record',page:4},
      {from:4,label:'Previous record',page:3}, {from:3,label:'Previous view',page:4},
      {from:4,label:'Next view',page:3}, {from:3,label:'First record',page:1}
    ];
    if (process.argv.includes('--observe')) {
      await printed(1, 'Next record').click();
      console.log(JSON.stringify({ hits, page: await page.locator('.pdf-toolbar > span').innerText() })); return;
    }
    assert.deepEqual(hits, reference?.linkedAreas || [true,false,true]);
    for (const [i, { from, label, page: to }] of expected.entries()) {
      await toolbar(from).waitFor();
      if (i % 2 === 0) await printed(from, label).click();
      else {
        const link = page.locator('[data-pdf-page="' + from + '"] .pdf-page-links').getByRole('link', { name: label, exact: true });
        await link.focus(); await link.press('Enter');
      }
      await toolbar(to).waitFor(); steps.push([from,label,to]);
    }
    await page.getByRole('button', { name: 'Zoom in PDF', exact: true }).click();
    await page.setViewportSize({ width: 1240, height: 790 });
    const before = await app.evaluate(() => global.__outgoing.length);
    await printed(1, lines[1]).click();
    assert.equal(await app.evaluate(() => global.__outgoing.length), before);
    await printed(1, lines[2]).click();
    const wrapped = page.locator('[data-pdf-page="1"] .pdf-page-links').getByRole('link', { name: 'Calibration reference and data appendix', exact: true });
    assert.equal(await wrapped.count(), 1, 'Two linked fragments should have one keyboard tab stop');
    await wrapped.focus(); await wrapped.press('Enter');
    assert.deepEqual(await app.evaluate(() => global.__outgoing), Array(4).fill('https://doi.org/10.21105/joss.01864'));
    console.log(JSON.stringify({ hits, steps, resized: true, wrappedLinkTabStops: 1 }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
