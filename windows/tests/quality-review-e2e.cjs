const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openPasteText, loadPastedText, openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'quality-review-'));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1 }));
  const notebook = require('./mac-parity/fixtures.json').papers.find(p => p.name === 'Extraction review of copied lab notes');
  const prefix = Array.from({ length: 39 }, (_, i) => 'Exposure ' + (i + 1) + ' was compared against reference lamps such as');
  const text = [...prefix, ...notebook.blocks.map(b => b.text)].join('\n\n');
  const native = process.env.PAPERBRIDGE_MAC_REFERENCE;
  const reference = native ? JSON.parse(fs.readFileSync(native, 'utf8')).papers.find(p => p.name === notebook.name) : null;
  if (native) assert.ok(reference, 'The Mac artifact must contain the copied lab notes.');
  const expected = (reference?.issues.map(v => v.id) || [1, 2, 3, 5]).map(id => id + prefix.length);
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await openPasteText(page);
    await page.locator('.paste-area').fill(text);
    const id = await loadPastedText(page, { view: 'Reader' });
    const saved = () => page.evaluate(id => window.paperBridge.loadPaper(id), id);
    const original = (await saved()).blocks.map(b => b.text);
    assert.equal(original.length, prefix.length + notebook.blocks.length);
    const warnings = page.locator('article.block:has(.quality-warning)');
    const ids = await warnings.evaluateAll(rows => rows.map(row => Number(row.id.slice(6))));
    const actualTail = ids.filter(n => n > prefix.length);
    console.log(JSON.stringify({ issues: ids.length, tail: actualTail, expected, native: Boolean(reference) }));
    if (process.argv.includes('--observe')) return;
    assert.deepEqual(actualTail, expected);
    assert.equal(ids.length, prefix.length + expected.length);
    const modes = page.getByRole('radiogroup', { name: 'Reading mode' });
    await modes.getByRole('radio', { name: 'Translation', exact: true }).check();
    await openWorkspaceView(page, 'Overview');
    const quality = page.locator('.quality-list');
    await quality.locator('summary').click();
    assert.match(await quality.locator('summary').innerText(), new RegExp('Check ' + ids.length + ' possible'));
    assert.equal(await quality.locator('.quality-item').count(), 40);
    const last = quality.locator('.quality-item').last();
    const boundaryId = ids[39];
    assert.equal(await last.locator('blockquote').textContent(), original[boundaryId - 1]);
    await last.getByRole('button', { name: 'Review block ' + boundaryId, exact: true }).click();
    assert.ok(await modes.getByRole('radio', { name: 'Bilingual', exact: true }).isChecked());
    await page.locator('#block-' + boundaryId + '.current').waitFor();
    const lastId = ids.at(-1);
    const offList = page.locator('#block-' + lastId);
    await offList.getByRole('button', { name: 'Bookmark', exact: true }).click();
    await offList.getByRole('button', { name: 'Compare Original' }).click();
    assert.equal(await page.getByLabel('Paper display mode').inputValue(), 'source');
    await page.getByRole('button', { name: 'Back to previous reading location', exact: true }).click();
    await offList.locator('.quality-warning').waitFor();
    assert.deepEqual((await saved()).blocks.map(b => b.text), original);
    await offList.getByRole('button', { name: 'Edit or Split', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Repair Paragraph ' + lastId });
    const corrected = 'The comparison used the independent lamp exposure at the same temperature.';
    await editor.getByRole('textbox', { name: 'Paragraph source' }).fill(corrected);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await offList.locator('.quality-warning').waitFor({ state: 'detached' });
    await offList.getByText(corrected, { exact: true }).waitFor();
    assert.equal(await offList.getByRole('button', { name: 'Bookmark', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(async ({ id, lastId, corrected }) =>
      (await window.paperBridge.loadPaper(id)).blocks[lastId - 1].text === corrected, { id, lastId, corrected });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('#block-' + lastId).getByText(corrected, { exact: true }).waitFor();
    assert.equal(await page.locator('article.block:has(.quality-warning)').count(), ids.length - 1);
    assert.equal(await page.locator('#block-' + lastId).getByRole('button', { name: 'Bookmark', exact: true }).getAttribute('aria-pressed'), 'true');
    const final = (await saved()).blocks.map(b => b.text);
    const expectedText = [...original]; expectedText[lastId - 1] = corrected;
    assert.deepEqual(final, expectedText);
    console.log('Reviewed the fortieth suggestion in bilingual mode, compared and corrected a later block, and reopened its saved bookmark.');
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
