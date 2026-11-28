const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { createStore, defaults } = require('../electron/storage.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'library-edit-return-')), store = createStore(dir);
  store.saveSettings({ ...defaults, onboardingCompletedVersion: 1, autoCheckUpdates: false });
  for (let i = 1; i <= 45; i++) {
    const name = 'Observation ' + String(i).padStart(2, '0'), id = createHash('sha256').update(name).digest('hex');
    store.savePaper({ id, name, tags: [i > 4 ? 'spectroscopy' : 'draft'], type: 'text', sourceMode: 'text',
      extraction: 'Pasted text', createdAt: new Date(2026, 8, i).toISOString(), position: {},
      blocks: [{ id: 1, text: 'The reading was 532 nm.', bookmark: true }] });
  }
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ cwd: root, ...(exe && { executablePath: exe }), args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.setViewportSize({ width: 1280, height: 710 });
    await page.locator('button[title="Open library"]').click();
    const library = page.getByRole('dialog', { name: 'Paper Library', exact: true });
    const editor = page.getByRole('dialog', { name: 'Edit Library Label', exact: true });
    const search = library.getByPlaceholder('Search titles and tags');
    await search.fill('spectroscopy');
    const buttons = library.getByRole('button', { name: /^Edit label for / });
    const row = buttons.nth(29), original = (await row.getAttribute('aria-label')).slice('Edit label for '.length);
    const id = createHash('sha256').update(original).digest('hex');
    await row.scrollIntoViewIfNeeded(); await row.focus();
    const body = library.locator('.modal-body');
    const offset = await body.evaluate(node => node.scrollTop);
    assert.ok(offset > 300);
    const enter = async () => { await page.keyboard.press('Enter'); await editor.waitFor(); };
    const location = () => page.evaluate(() => ({ scroll: document.querySelector('.modal-body')?.scrollTop, focus: document.activeElement?.getAttribute('aria-label') }));
    const verifyReturn = async name => {
      await library.waitFor();
      assert.equal(await search.inputValue(), 'spectroscopy');
      const pos = await location();
      assert.equal(pos.focus, 'Edit label for ' + name);
      assert.ok(Math.abs(pos.scroll - offset) <= 3, JSON.stringify({ offset, pos }));
    };
    await enter(); await editor.getByLabel('Title', { exact: true }).fill('Uncommitted edit');
    await page.keyboard.press('Escape');
    if (process.argv.includes('--observe')) {
      console.log(JSON.stringify({ expectedRow: original, offset, libraryOpen: Boolean(await library.count()), current: await location() })); return;
    }
    await verifyReturn(original);
    assert.equal(store.list().find(entry => entry.id === id).name, original);
    for (const close of ['Cancel', 'Close dialog', 'backdrop']) {
      await enter();
      if (close === 'backdrop') await page.mouse.click(6, 6);
      else await editor.getByRole('button', { name: close, exact: true }).click();
      await verifyReturn(original);
    }
    await enter();
    const input = editor.getByLabel('Title', { exact: true });
    assert.ok(await input.evaluate(node => document.activeElement === node));
    await input.fill('');
    const session = await page.context().newCDPSession(page);
    await session.send('Input.imeSetComposition', { text: '低温观测', selectionStart: 4, selectionEnd: 4 });
    await input.press('Enter');
    await editor.waitFor();
    await session.send('Input.insertText', { text: '低温观测记录' });
    await session.detach();
    assert.equal(await input.inputValue(), '低温观测记录');
    await input.press('Enter');
    await verifyReturn('低温观测记录');
    await enter();
    await editor.getByLabel('Tags, separated by commas').fill('reviewed');
    await editor.getByRole('button', { name: 'Save label', exact: true }).click();
    await library.waitFor();
    assert.equal(await search.inputValue(), 'spectroscopy');
    assert.equal(await buttons.count(), 40);
    assert.equal((await location()).focus, await buttons.nth(29).getAttribute('aria-label'));
    assert.deepEqual(store.list().find(item => item.id === id).tags, ['reviewed']);
    assert.ok(store.paper(id).blocks[0].bookmark);
    await search.fill('低温观测记录');
    await buttons.first().click();
    await editor.getByLabel('Title', { exact: true }).fill('Final checked label');
    await editor.getByRole('button', { name: 'Save label', exact: true }).click();
    await library.getByText('No matching papers. Try another title or tag.').waitFor();
    assert.ok(await search.evaluate(node => document.activeElement === node));
    console.log(JSON.stringify({ filtered: 41, offset, paths: ['Escape','Cancel','Close dialog','backdrop','Enter','Save label'],
      saved: store.list().find(item => item.id === id).name, fallbackToNextRowAndSearch: true }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
