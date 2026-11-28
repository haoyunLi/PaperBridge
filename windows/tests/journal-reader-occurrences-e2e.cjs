const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

// Both text sides come from the published journal and its recorded RX 7800 XT translation.
async function run() {
  const root = path.resolve(__dirname, '..'), fixtures = path.join(__dirname, 'mac-parity/tabbed');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'reader-occurrence-'));
  const sha = value => createHash('sha256').update(value).digest('hex');
  const markdown = fs.readFileSync(path.join(fixtures, 'article.md'), 'utf8').replaceAll('\r\n', '\n');
  const translations = require('./mac-parity/tabbed/translations.json');
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown).map(b => {
    const translated = translations[sha(b.sourceMarkdown)];
    return translated ? { ...b, translation: translated, translationMarkdown: translated, status: 'ok' } : b;
  });
  const target = blocks.find(b => b.text.startsWith('Delimiter separated value (DSV)'));
  const id = sha(markdown), data = path.join(dir, 'papers', id + '.json');
  fs.mkdirSync(path.dirname(data));
  fs.writeFileSync(data, JSON.stringify({ id, name: 'Tabbed', type: 'text', sourceMode: 'mineru', mineruMarkdown: markdown,
    blocks, mineruBlocks: blocks, inspectorOpen: true, position: { tab: 'Reader', displayMode: 'bilingual', block: target.id } }));
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).journalDraft.readerOccurrences;
  assert.equal(native?.length, 14);
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app = await launch();
  try {
    let page = await app.firstWindow(); await page.setViewportSize({ width: 1470, height: 880 });
    await openWorkspaceView(page, 'Reader');
    const count = { original: 0, translation: 0 }, records = [];
    for (const sample of native) {
      const occurrence = ++count[sample.side];
      const side = sample.side === 'original' ? 'source' : 'translation';
      const host = page.locator('#block-' + target.id + ' [data-kind="' + side + '"]');
      const point = await host.evaluate((surface, occurrence) => {
        const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
        let seen = 0;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          for (const match of n.data.matchAll(/DSV/g)) {
            if (++seen !== occurrence) continue;
            const range = new Range();
            range.setStart(n, match.index); range.setEnd(n, match.index + match[0].length);
            const scroll = surface.closest('.main-scroll');
            scroll.scrollTop += range.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight / 2;
            const box = range.getBoundingClientRect();
            return { left: box.left + 0.5, right: box.right - 0.5, y: box.y + box.height / 2 };
          }
        }
        throw Error('Missing displayed occurrence ' + occurrence);
      }, occurrence);
      await page.mouse.move(point.left, point.y);
      await page.mouse.down(); await page.mouse.move(point.right, point.y, { steps: 8 }); await page.mouse.up();
      assert.equal(await page.locator('.inspector-quote-text').innerText(), 'DSV');
      const body = sample.side + ' occurrence ' + occurrence;
      await page.getByLabel('Note for selected passage').fill(body);
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async ({ id, blockID, body }) => {
        const p = await window.paperBridge.loadPaper(id);
        return p.blocks.find(b => b.id === blockID).notes.some(note => note.body === body);
      }, { id, blockID: target.id, body });
      const note = JSON.parse(fs.readFileSync(data, 'utf8')).blocks.find(b => b.id === target.id).notes.find(n => n.body === body);
      assert.deepEqual([note.scope, note.kind, note.text, note.offset, note.text.length],
        [sample.scope, side, sample.text, sample.offset, sample.length], body);
      records.push({ body, side, offset: sample.offset });
    }
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.setViewportSize({ width: 1120, height: 790 });
    for (const record of [...records].reverse()) {
      await openWorkspaceView(page, 'Overview');
      const entry = page.locator('.annotation-row').filter({ has: page.getByText(record.body, { exact: true }) });
      await entry.locator('.annotation-navigate').click();
      await page.waitForFunction(body => document.querySelector('.inspector textarea')?.value === body, record.body);
      const restored = await page.evaluate(() => {
        const selected = getSelection(), range = selected.getRangeAt(0);
        const host = range.startContainer.parentElement.closest('[data-kind]');
        const before = new Range(); before.selectNodeContents(host); before.setEnd(range.startContainer, range.startOffset);
        return [host.dataset.kind, before.toString().length, selected.toString()];
      });
      assert.deepEqual(restored, [record.side, record.offset, 'DSV'], record.body + ' after restart');
    }
    console.log(JSON.stringify({ dir, original: count.original, translation: count.translation, restored: records.length }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
