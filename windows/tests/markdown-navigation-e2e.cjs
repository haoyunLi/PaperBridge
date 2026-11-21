const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'markdown-navigation-'));
  const markdown = fs.readFileSync(path.join(__dirname, 'mac-parity', 'markdown-navigation.md'), 'utf8');
  const { parsedMarkdownBlocks } = await import('../src/academicMarkdown.mjs');
  const blocks = parsedMarkdownBlocks(markdown).map(block => ({
    ...block, translation: block.text, translationMarkdown: block.sourceMarkdown, status: 'ok'
  }));
  const id = createHash('sha256').update(markdown).digest('hex');
  const paper = { id, type: 'text', name: 'Workshop notes', sourceMode: 'mineru', mineruMarkdown: markdown, mineruBlocks: blocks, blocks,
    position: { tab: 'Paper', block: 1, displayMode: 'bilingual' }, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(dir, 'papers'));
  fs.writeFileSync(path.join(dir, 'papers', id + '.json'), JSON.stringify(paper));
  fs.writeFileSync(path.join(dir, 'last-paper.json'), JSON.stringify({ id }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const cases = process.env.PAPERBRIDGE_MAC_REFERENCE
    ? JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).markdownNavigation
    : [{ label: 'Second results table', id: 'results-2', heading: 'Results' }, { label: 'Résumé', id: 'résumé-结果', heading: 'Résumé 结果!' }, { label: 'Appendix', id: 'section', heading: '!!!' }];
  assert.equal(cases.length, 3);
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const open = () => electron.launch({ cwd: root, ...(executablePath && { executablePath }),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  async function closeWindow(instance) {
    const closed = instance.waitForEvent('close', { timeout: 15000 });
    await instance.evaluate(({ BrowserWindow }) => { setImmediate(() => BrowserWindow.getAllWindows()[0].close()); });
    await closed;
  }
  let app = await open();
  try {
    let page = await app.firstWindow();
    await page.locator('.document-preview').waitFor();
    await page.waitForFunction(() => document.querySelector('.main-scroll')?.getAttribute('aria-busy') === 'false');
    const scroll = () => page.locator('.main-scroll').evaluate(host => host.scrollTop);
    for (const side of ['source', 'translation']) {
      const passages = page.locator(`.document-preview [data-paper-kind="${side}"]`);
      for (const { label, id: fragment, heading } of cases) {
        const link = passages.getByRole('link', { name: label, exact: true });
        assert.equal(decodeURIComponent((await link.getAttribute('href')).slice(1)), fragment);
        await link.focus();
        await link.press('Enter');
        const target = passages.getByRole('heading', { name: heading, exact: true }).last();
        await target.evaluate(node => {
          if (document.activeElement !== node) throw Error('Did not focus the correct heading in the selected language');
          const viewport = document.querySelector('.main-scroll').getBoundingClientRect(), bounds = node.getBoundingClientRect();
          if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) throw Error('The heading is outside the reading viewport');
        });
      }
    }
    const finalScroll = await scroll();
    assert.ok(finalScroll > 100);
    await closeWindow(app);
    app = null;
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'papers', id + '.json'), 'utf8'));
    assert.ok(Math.abs((stored.position.scrollByTab?.Paper ?? -1) - finalScroll) < 3, 'Closing immediately after the link must save its destination');
    app = await open(); page = await app.firstWindow();
    await page.locator('.document-preview').waitFor();
    await page.waitForFunction(() => document.querySelector('.main-scroll')?.getAttribute('aria-busy') === 'false');
    await page.waitForFunction(value => Math.abs(document.querySelector('.main-scroll').scrollTop - value) < 4, finalScroll, { timeout: 10000 });
    if (process.argv.includes('--reflow')) {
      const heading = process.env.PAPERBRIDGE_MAC_REFERENCE ? cases[0].restoredAfterReflow : 'Results';
      assert.ok(heading, 'Expected the reflow result from the native Mac preview');
      const target = () => page.locator('.document-preview [data-paper-kind="translation"]').getByRole('heading', { name: heading, exact: true }).last();
      const offset = () => target().evaluate(node => node.getBoundingClientRect().top - document.querySelector('.main-scroll').getBoundingClientRect().top);
      await target().evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
      const beforeOffset = await offset(), beforeY = await scroll();
      assert.ok(Math.abs(beforeOffset) < 3);
      await closeWindow(app); app = null;
      const settingsFile = path.join(dir, 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, fontSize: 27, readingWidth: 560 }));
      app = await open(); page = await app.firstWindow();
      await target().waitFor();
      await page.waitForFunction(() => document.querySelector('.main-scroll')?.getAttribute('aria-busy') === 'false');
      assert.ok(Math.abs(await offset() - beforeOffset) < 3, 'The same translated heading must return to its previous place in the viewport');
      assert.ok(Math.abs(await scroll() - beforeY) > 10, 'The new text geometry must require a different scroll position');
    }
    console.log(JSON.stringify({ jumps: cases.length * 2, scrollRestored: true, reflow: process.argv.includes('--reflow'), native: Boolean(process.env.PAPERBRIDGE_MAC_REFERENCE) }));
  } finally { await app?.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
