const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { keepMineruResult } = require('../electron/mineru-resources.cjs');
const { readMineruMarkdown } = require('../electron/mineru-output.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), fixtures = path.join(__dirname, 'mac-parity');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'literal-assets-'));
  const folder = path.join(workspace, 'extraction'), destination = path.join(workspace, 'export');
  const written = fs.readFileSync(path.join(fixtures, 'literal-asset-examples.md'), 'utf8').replace(/\r\n/g, '\n');
  const data = require('./mac-parity/bundle-fixture.json');
  const image = Buffer.from(data.imageBase64, 'base64');
  for (const dir of ['figures', 'data']) fs.mkdirSync(path.join(folder, dir), { recursive: true });
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(folder, 'figures', 'response.png'), image);
  fs.writeFileSync(path.join(folder, 'data', 'measurements.csv'), data.csv);
  const document = path.join(folder, 'examples.md');
  fs.writeFileSync(document, written);
  const markdown = readMineruMarkdown(document);
  const id = crypto.createHash('sha256').update(written).digest('hex');
  const resourceId = keepMineruResult(workspace, id, document, markdown);
  const { parsedMarkdownBlocks, markdownBlockKind } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown);
  const code = blocks.filter(block => block.markdownKind === 'code');
  assert.equal(code.length, 3);
  assert.ok(code.every(block => block.resource && markdownBlockKind(block) === 'code'));
  const paper = { id, name: 'Calibration examples', type: 'text', sourceMode: 'mineru', mineruMarkdown: markdown,
    mineruResourceId: resourceId, blocks, mineruBlocks: blocks, position: { tab: 'Paper', displayMode: 'source', block: 1 } };
  fs.mkdirSync(path.join(workspace, 'papers'));
  fs.writeFileSync(path.join(workspace, 'papers', id + '.json'), JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1 }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace } });
  const exampleLines = ['![Example response](figures/response.png)', '<img src="figures/response.png" alt="Example response">',
    '<a href="data/measurements.csv">Sample table</a>', '[Sample measurements](data/measurements.csv)'];
  async function checkReader(page) {
    await openWorkspaceView(page, 'Reader');
    const reader = page.locator('.main-scroll');
    await reader.locator('pre code').first().waitFor();
    const examples = (await reader.locator('pre code').allTextContents()).join('\n');
    for (const line of exampleLines) assert.ok(examples.includes(line), 'Reader code must contain the literal ' + line);
    const actual = reader.locator('img[alt="Measured response"]').first();
    await actual.waitFor();
    assert.equal(await actual.evaluate(img => img.naturalWidth), 1);
  }
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await checkReader(page);
    await app.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      shell.showItemInFolder = folder => { global.exportedExamples = folder; };
    }, destination);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Export Markdown Bundle', exact: true }).click();
    await page.getByText(/Exported .*Markdown files/).first().waitFor();
    const exported = await app.evaluate(() => global.exportedExamples);
    assert.equal(path.dirname(exported), destination);
    const moved = path.join(workspace, 'Offline copy');
    fs.renameSync(exported, moved);
    const copy = fs.readFileSync(path.join(moved, 'paper_original.md'), 'utf8');
    const literals = written.slice(written.indexOf('    ![Example'), written.indexOf('![Measured response]'));
    assert.ok(copy.includes(literals.trimEnd()), 'The moved bundle must preserve the example code, its indentation and the printed filenames');
    const links = [...copy.matchAll(/\[(?:Measured response|Recorded measurements)\]\(([^)]+)\)/g)].map(match => decodeURIComponent(match[1]));
    assert.equal(links.length, 2);
    assert.deepEqual(fs.readFileSync(path.join(moved, links[0])), image);
    assert.equal(fs.readFileSync(path.join(moved, links[1]), 'utf8'), data.csv);
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
      const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).bundle.literalDocument;
      assert.equal(native, written);
      assert.ok(copy.includes(native.slice(native.indexOf('    ![Example'), native.indexOf('![Measured response]')).trimEnd()));
    }
    await app.close(); app = await launch(); page = await app.firstWindow(); await checkReader(page);
    console.log(JSON.stringify({ workspace, examples: code.length, printedLines: exampleLines.length, movedAssets: links.length,
      reopened: true, comparedWithMac: Boolean(process.env.PAPERBRIDGE_MAC_REFERENCE) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
