const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { keepMineruResult } = require('../electron/mineru-resources.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), fixtures = path.join(__dirname, 'mac-parity');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'paper-attachments-'));
  const markdown = fs.readFileSync(path.join(fixtures, 'supplement-links.md'), 'utf8');
  const id = createHash('sha256').update(markdown).digest('hex');
  const source = path.join(workspace, 'input'), support = path.join(source, 'supplement');
  fs.mkdirSync(support, { recursive: true });
  fs.mkdirSync(path.join(source, 'images'));
  fs.copyFileSync(path.join(fixtures, 'supplement-protocol.md'), path.join(support, 'protocol.md'));
  fs.copyFileSync(path.join(fixtures, 'landscape-swatches.pdf'), path.join(support, 'Reference pages.pdf'));
  fs.copyFileSync(path.join(fixtures, 'tabbed', 'images', 'page_2_chart_5.jpg'), path.join(source, 'images', 'panel.jpg'));
  fs.copyFileSync(path.join(source, 'images', 'panel.jpg'), path.join(support, 'panel.jpg'));
  const csv = 'sample,temperature\ncontrol,18.5\n';
  fs.writeFileSync(path.join(support, '温度.csv'), csv);
  const document = path.join(source, 'paper.md');
  fs.writeFileSync(document, markdown);
  const resourceId = keepMineruResult(workspace, id, document, markdown);
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown).map(item => ({ ...item, translation: item.text, translationMarkdown: item.sourceMarkdown, status: 'ok' }));
  const paper = { id, name: 'Calibration data', type: 'text', sourceMode: 'mineru', blocks, mineruBlocks: blocks, mineruMarkdown: markdown,
    mineruResourceId: resourceId, connectedTranslation: markdown, position: { tab: 'Paper', displayMode: 'original', block: 1 }, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(workspace, 'papers'));
  fs.writeFileSync(path.join(workspace, 'papers', id + '.json'), JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')], env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.locator('.document-preview').waitFor();
    const readerUrl = page.url();
    await app.evaluate(({ shell }) => { global.pdfRequests = []; shell.openPath = async file => { global.pdfRequests.push(file); return ''; }; });
    const expectedPdf = path.join(workspace, 'mineru-results', resourceId, 'supplement', 'Reference pages.pdf');
    const readerLink = name => page.locator('.main-scroll').getByRole('link', { name, exact: true }).first();
    const dialog = page.getByRole('dialog');
    const observed = [];
    const record = async (source, label, policy, fragment = '') => {
      const relative = policy === 'systemPDF' ? path.relative(path.dirname(path.dirname(expectedPdf)), await app.evaluate(() => global.pdfRequests.at(-1))).split(path.sep).join('/')
        : await dialog.locator('[data-attachment-path]').getAttribute('data-attachment-path');
      observed.push({ source, label, path: relative, policy, fragment });
    };
    for (const tab of ['Paper', 'Reader', 'Full Translation']) {
      await openWorkspaceView(page, tab);
      await readerLink('Reference PDF').focus();
      await readerLink('Reference PDF').press('Enter');
      await page.waitForFunction(() => document.querySelector('.main-scroll')?.dataset.readingPaperId);
      await readerLink('Calibration protocol').click();
      await dialog.getByRole('heading', { name: 'Measurements', exact: true }).waitFor();
      await page.waitForFunction(() => document.activeElement?.textContent === 'Measurements');
      if (tab === 'Paper') {
        await record('supplement-links.md', 'Calibration protocol', 'preview', 'measurements');
        await record('supplement-links.md', 'Reference PDF', 'systemPDF');
      }
      await dialog.getByRole('img', { name: 'Reference response' }).evaluate(img => img.decode());
      assert.equal(await dialog.getByRole('img', { name: 'Reference response' }).evaluate(img => img.naturalWidth), 530);
      await dialog.getByRole('link', { name: 'Measurements CSV' }).click();
      await dialog.getByRole('heading', { name: '温度.csv' }).waitFor();
      assert.equal(await dialog.locator('pre').textContent(), csv);
      if (tab === 'Paper') await record('supplement-protocol.md', 'Measurements CSV', 'preview');
      await dialog.getByRole('button', { name: 'Back' }).click();
      await dialog.getByRole('link', { name: 'Full-size panel' }).click();
      await dialog.getByRole('img', { name: 'panel.jpg' }).evaluate(img => img.decode());
      assert.equal(await dialog.getByRole('img', { name: 'panel.jpg' }).evaluate(img => img.naturalHeight), 418);
      if (tab === 'Paper') await record('supplement-protocol.md', 'Full-size panel', 'preview');
      await dialog.getByRole('button', { name: 'Back' }).click();
      await dialog.getByRole('link', { name: 'Reference PDF' }).click();
      await dialog.getByRole('button', { name: 'Close dialog' }).click();
      assert.equal(page.url(), readerUrl);
      if (tab === 'Paper') await record('supplement-protocol.md', 'Reference PDF', 'systemPDF');
    }
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
      const mac = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8'));
      assert.deepEqual(observed, mac.attachmentLinks, 'The same links must open the same retained resources as the native Mac reader');
    }
    assert.deepEqual(await app.evaluate(() => global.pdfRequests), Array(6).fill(expectedPdf));
    await readerLink('Missing file').click();
    await page.getByText(/This attachment is missing from the saved paper/).first().waitFor();
    assert.equal(page.url(), readerUrl);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await readerLink('Calibration protocol').click();
    await page.getByRole('dialog').getByRole('heading', { name: 'Measurements', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await readerLink('Calibration protocol').evaluate(link => link === document.activeElement), true, 'Closing the supplement must return keyboard focus to its link');
    assert.equal(page.url(), readerUrl);
    const destination = path.join(workspace, 'exports');
    fs.mkdirSync(destination);
    await app.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      shell.showItemInFolder = path => { global.exportedFolder = path; };
    }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
    await page.getByText(/Exported .*Markdown files/).first().waitFor();
    const exported = await app.evaluate(() => global.exportedFolder);
    assert.equal(path.dirname(exported), destination);
    const moved = path.join(workspace, 'Moved paper');
    fs.renameSync(exported, moved);
    const original = fs.readFileSync(path.join(moved, 'paper_original.md'), 'utf8');
    assert.match(original, /assets\/source\/supplement\/protocol\.md#measurements/);
    assert.match(original, /assets\/source\/supplement\/Reference%20pages\.pdf/);
    for (const name of ['supplement/protocol.md', 'supplement/Reference pages.pdf', 'supplement/温度.csv', 'images/panel.jpg', 'supplement/panel.jpg']) {
      assert.deepEqual(fs.readFileSync(path.join(moved, 'assets', 'source', name)), fs.readFileSync(path.join(source, name)), name);
    }
    console.log(JSON.stringify({ views: 3, reopened: true, movedBundleFiles: 5, pdfHandoffs: 6, text: '温度.csv', image: [530, 418], nativeCompared: Boolean(process.env.PAPERBRIDGE_MAC_REFERENCE) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
