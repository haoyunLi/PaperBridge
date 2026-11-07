const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');
const { openPasteText, loadPastedText } = require('./sidebar-controls.cjs');

const paperAText = 'Abstract\n\nPaper A contains the newer saved content.';
const paperAId = crypto.createHash('sha256').update(paperAText).digest('hex');
const paperBId = 'b'.repeat(64);

async function bounded(label, operation, timeout = 15000) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
  })]); } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await bounded(label, Promise.resolve().then(predicate), Math.max(1, deadline - Date.now()))) return; } catch { /* IPC write may still be in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function paper(id, name, text, updatedAt) {
  return {
    id, name, type: 'text', createdAt: '2026-01-01T00:00:00.000Z', updatedAt,
    blocks: [{ id: 1, text: 'Abstract', heading: true, translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] },
      { id: 2, text, heading: false, translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] }],
    tags: [], summary: null, connectedTranslation: '', extraction: 'Pasted text', inspectorOpen: true,
    position: { block: 1, page: 1, tab: 'Paper', displayMode: 'bilingual' }
  };
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'last-opened-'));
  const papersDir = path.join(workspace, 'papers');
  fs.mkdirSync(papersDir, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ autoCheckUpdates: false, onboardingCompletedVersion: 1, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const a = paper(paperAId, 'Recently edited A', 'Paper A contains the newer saved content.', '2099-01-01T00:00:00.000Z');
  const b = paper(paperBId, 'Last opened B', 'Paper B is the last paper opened without editing.', '2020-01-01T00:00:00.000Z');
  b.blocks[1] = { ...b.blocks[1], translation: '保留已有翻译。', status: 'ok' };
  fs.writeFileSync(path.join(papersDir, `${paperAId}.json`), JSON.stringify(a));
  fs.writeFileSync(path.join(papersDir, `${paperBId}.json`), JSON.stringify(b));
  const lastPaperFile = path.join(workspace, 'last-paper.json');
  fs.writeFileSync(lastPaperFile, JSON.stringify({ id: paperBId }));
  const libraryIndexFile = path.join(workspace, 'library-index.json');
  // A real filesystem obstruction must not make readable papers disappear.
  fs.mkdirSync(libraryIndexFile);

  const paperFile = id => path.join(papersDir, `${id}.json`);
  const bodyFiles = id => [paperFile(id), `${paperFile(id)}.backup`].map(file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const libraryIndex = () => JSON.parse(fs.readFileSync(libraryIndexFile, 'utf8'));
  const unreadableMessage = 'This saved paper could not be read. Its library entry was retained; try importing the original again.';
  const persistenceMessage = 'Library labels and metadata were not persisted. Fix the storage issue, then retry.';
  const errors = [], stages = [];
  let app, page, failure;
  const close = async () => {
    if (!app) return;
    const owned = app, child = owned.process();
    try { await bounded('owned Electron close', owned.close(), 15000); }
    catch (error) {
      console.error(error.stack); failure ||= error;
      if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        await bounded('owned Electron termination', new Promise((resolve, reject) => {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, cause => cause ? reject(cause) : resolve());
        }), 12000).catch(cause => console.error(cause.stack));
      }
      throw error;
    } finally { app = null; }
  };
  const launch = async () => {
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(workspace, 'electron-profile')}`], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded('first Electron window', app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1320, height: 820 });
  };
  const librarySnapshot = () => bounded('library snapshot', page.evaluate(() => window.paperBridge.bootstrap()));
  const loadedPaper = id => bounded('saved paper overlay', page.evaluate(id => window.paperBridge.loadPaper(id), id));
  const editLabel = async (name, title, tags, response = 'normal') => {
    if (response !== 'normal') await bounded('metadata failure/latency fixture', app.evaluate(({ ipcMain }, response) => {
      const handler = ipcMain._invokeHandlers.get('paper:update-library-metadata');
      if (!handler) throw new Error('The real library metadata IPC handler must exist');
      let first = true;
      ipcMain.removeHandler('paper:update-library-metadata');
      ipcMain.handle('paper:update-library-metadata', async (...args) => {
        if (first && response === 'failure') { first = false; throw new Error('Injected library metadata save failure'); }
        const result = await handler(...args);
        if (first && response === 'delayed') {
          first = false;
          await new Promise(resolve => { globalThis.releaseLibraryMetadata = resolve; });
        }
        return result;
      });
    }, response));
    await page.getByRole('button', { name: `Edit label for ${name}`, exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Tags, separated by commas').fill(tags);
    const beforeIndex = fs.readFileSync(path.join(workspace, 'library-index.json'), 'utf8');
    await page.getByRole('button', { name: 'Save label', exact: true }).click();
    if (response === 'failure') {
      await page.getByRole('alert').getByText('Injected library metadata save failure', { exact: false }).waitFor();
      assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), title);
      assert.equal(fs.readFileSync(path.join(workspace, 'library-index.json'), 'utf8'), beforeIndex, 'Failed metadata save keeps the existing index');
      await page.screenshot({ path: path.join(workspace, 'label-save-error.png'), timeout: 5000 });
      await page.getByRole('button', { name: 'Save label', exact: true }).click();
    } else if (response === 'delayed') {
      await waitFor(() => bounded('held metadata response', app.evaluate(() => typeof globalThis.releaseLibraryMetadata === 'function')), 'metadata response to be held');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.locator('.sidebar-footer').getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      await bounded('release metadata response', app.evaluate(() => { globalThis.releaseLibraryMetadata(); delete globalThis.releaseLibraryMetadata; }));
      await page.locator('.library-row').filter({ hasText: title }).waitFor();
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Paper Library', exact: true }).count(), 0, 'Late completion cannot replace a newly opened Settings dialog');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.locator('button[title="Open library"]').click();
    }
    await page.getByRole('heading', { name: 'Paper Library', exact: true }).waitFor();
  };
  try {
    const beforeStartupB = bodyFiles(paperBId);
    await launch();
    await page.getByRole('heading', { name: 'Last opened B' }).waitFor({ timeout: 20000 });
    await page.locator('.save-status.idle').getByText('Saved on this PC', { exact: true }).waitFor();
    await page.getByRole('alert').getByText(persistenceMessage, { exact: true }).waitFor();
    const blocked = await librarySnapshot();
    assert.equal(blocked.libraryPersistenceWarning, persistenceMessage);
    assert.equal(blocked.library.length, 2, 'An index write failure retains the readable in-memory library');
    assert.ok(blocked.library.every(item => item.workspaceAvailable === true));
    assert.deepEqual(bodyFiles(paperBId), beforeStartupB, 'Failed index migration does not rewrite the loaded paper');
    await page.screenshot({ path: path.join(workspace, 'library-index-write-warning.png'), timeout: 5000 });
    assert.equal(fs.statSync(libraryIndexFile).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(libraryIndexFile), []);
    fs.rmdirSync(libraryIndexFile);
    await page.locator('button[title="Open library"]').click();
    await page.getByRole('heading', { name: 'Paper Library', exact: true }).waitFor();
    await waitFor(() => fs.statSync(libraryIndexFile).isFile() && Object.keys(libraryIndex().entries).length === 2, 'opening Library to retry index persistence');
    await page.getByRole('alert').getByText(persistenceMessage, { exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await librarySnapshot()).libraryPersistenceWarning, '');
    assert.equal(await page.locator('.modal-list-row').count(), 2);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    assert.deepEqual(bodyFiles(paperBId), beforeStartupB);
    stages.push('Unreadable index destination shows a warning while readable papers load; Library refresh retries and clears it without body writes');
    assert.equal(JSON.parse(fs.readFileSync(path.join(papersDir, `${paperBId}.json`), 'utf8')).updatedAt, b.updatedAt,
      'showing saved state on a clean reopen must not manufacture a content write');
    assert.match(await page.locator('.document-preview').innerText(), /Paper B is the last paper opened/);
    await page.locator('.library-row').first().getByText('Last opened B').waitFor();

    await page.locator('.library-row').filter({ hasText: 'Recently edited A' }).click();
    await page.getByRole('heading', { name: 'Recently edited A' }).waitFor();
    await waitFor(() => JSON.parse(fs.readFileSync(lastPaperFile, 'utf8')).id === paperAId, 'A open marker');
    await page.locator('.library-row').first().getByText('Recently edited A').waitFor();
    await page.locator('.library-row').filter({ hasText: 'Last opened B' }).click();
    await page.getByRole('heading', { name: 'Last opened B' }).waitFor();
    await waitFor(() => JSON.parse(fs.readFileSync(lastPaperFile, 'utf8')).id === paperBId, 'B open marker');
    await page.locator('.library-row').first().getByText('Last opened B').waitFor();
    await page.locator('button[title="Open library"]').click();
    await page.locator('.modal-list-row').first().getByText(/1\/2 translated · Opened/).waitFor();
    const beforeLabelB = bodyFiles(paperBId);
    await editLabel('Last opened B', 'Library label B', '进度, test, 进度', 'failure');
    assert.deepEqual(bodyFiles(paperBId), beforeLabelB, 'Saving a library label must not write the paper or its backup');
    assert.deepEqual(libraryIndex().entries[paperBId].tags, ['test', '进度']);
    assert.equal(libraryIndex().entries[paperBId].libraryTitle, 'Library label B');
    const overlayB = await loadedPaper(paperBId);
    assert.equal(overlayB.name, b.name);
    assert.equal(overlayB.libraryTitle, 'Library label B');
    assert.deepEqual(overlayB.tags, ['test', '进度']);
    assert.equal(overlayB.updatedAt, b.updatedAt);

    await bounded('metadata ordering fixture', app.evaluate(({ ipcMain }) => {
      const handler = ipcMain._invokeHandlers.get('paper:update-library-metadata');
      globalThis.metadataOrderingCalls = [];
      ipcMain.removeHandler('paper:update-library-metadata');
      ipcMain.handle('paper:update-library-metadata', async (...args) => {
        globalThis.metadataOrderingCalls.push(args[1].title);
        const result = await handler(...args);
        if (globalThis.metadataOrderingCalls.length === 1) {
          await new Promise(resolve => { globalThis.releaseMetadataOrdering = resolve; });
        }
        return result;
      });
    }));
    try {
      await page.getByRole('button', { name: 'Edit label for Library label B', exact: true }).click();
      await page.getByLabel('Title', { exact: true }).fill('Intermediate label B');
      await page.getByLabel('Tags, separated by commas').fill('temporary');
      await page.getByRole('button', { name: 'Save label', exact: true }).click();
      await waitFor(() => bounded('first metadata reply held', app.evaluate(() => typeof globalThis.releaseMetadataOrdering === 'function')), 'first metadata write before its held reply');
      assert.equal(libraryIndex().entries[paperBId].libraryTitle, 'Intermediate label B');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.locator('button[title="Open library"]').click();
      await page.getByRole('button', { name: 'Edit label for Intermediate label B', exact: true }).click();
      await page.getByLabel('Title', { exact: true }).fill('Library label B');
      await page.getByLabel('Tags, separated by commas').fill('进度, test, 进度');
      await page.getByRole('button', { name: 'Save label', exact: true }).click();
      await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
      // An independent renderer-to-main IPC round trip is a barrier after the
      // second save click; no sleep or guessed backend delay proves ordering.
      await librarySnapshot();
      assert.deepEqual(await bounded('metadata invocation order', app.evaluate(() => globalThis.metadataOrderingCalls)), ['Intermediate label B'],
        'The newer metadata request must not reach IPC until the older reply settles');
      assert.equal(libraryIndex().entries[paperBId].libraryTitle, 'Intermediate label B');
      await bounded('release first metadata reply', app.evaluate(() => { globalThis.releaseMetadataOrdering(); delete globalThis.releaseMetadataOrdering; }));
      await page.getByRole('heading', { name: 'Paper Library', exact: true }).waitFor();
      assert.deepEqual(await bounded('completed metadata invocation order', app.evaluate(() => globalThis.metadataOrderingCalls)), ['Intermediate label B', 'Library label B']);
      await page.locator('.modal-list-row').filter({ hasText: 'Library label B' }).waitFor();
      assert.equal(libraryIndex().entries[paperBId].libraryTitle, 'Library label B');
      assert.deepEqual(libraryIndex().entries[paperBId].tags, ['test', '进度']);
      assert.deepEqual(bodyFiles(paperBId), beforeLabelB, 'Queued metadata saves never write the paper or its backup');
      stages.push('Same-ID metadata saves serialize across dismissed editors; newer title wins without body writes');
    } finally {
      await bounded('release any remaining metadata hold', app.evaluate(() => {
        globalThis.releaseMetadataOrdering?.(); delete globalThis.releaseMetadataOrdering;
      }), 3000).catch(error => console.error(error.stack));
    }
    await page.getByPlaceholder('Search titles and tags').fill('进度');
    assert.equal(await page.locator('.modal-list-row').count(), 1);
    await page.locator('.modal-list-row').first().getByText('Library label B').waitFor();
    await page.getByPlaceholder('Search titles and tags').fill('nothing matches this');
    await page.getByText('No matching papers. Try another title or tag.').waitFor();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('heading', { name: 'Last opened B' }).waitFor();

    await close();
    assert.deepEqual(bodyFiles(paperBId), beforeLabelB, 'Closing after index-only labeling must not materialize an unrelated paper migration');
    assert.deepEqual(JSON.parse(fs.readFileSync(paperFile(paperAId), 'utf8')).blocks, a.blocks);
    // Corrupt both real files only after the owned application has exited.
    const corruptedA = ['{ broken primary workspace', '{ broken backup workspace'];
    fs.writeFileSync(paperFile(paperAId), corruptedA[0]);
    fs.writeFileSync(`${paperFile(paperAId)}.backup`, corruptedA[1]);
    stages.push('Recency, translated progress, index-only label/tag save, exact paper bytes and clean close');
    await launch();
    await page.getByRole('heading', { name: 'Last opened B' }).waitFor({ timeout: 20000 });
    assert.match(await page.locator('.document-preview').innerText(), /Paper B is the last paper opened/);
    await page.locator('.library-row').first().getByText('Library label B').waitFor();
    assert.equal(libraryIndex().entries[paperBId].libraryTitle, 'Library label B', 'The newer queued title survives a full restart');
    assert.deepEqual(libraryIndex().entries[paperBId].tags, ['test', '进度']);
    const savedB = JSON.parse(fs.readFileSync(path.join(papersDir, `${paperBId}.json`), 'utf8'));
    assert.deepEqual(savedB, b, 'Library-only edits retain legacy body content, timestamps and missing metadata exactly');
    let snapshot = await librarySnapshot();
    assert.equal(snapshot.library.find(item => item.id === paperAId).workspaceAvailable, false);
    assert.equal(snapshot.library.find(item => item.id === paperBId).workspaceAvailable, true);
    assert.equal(await loadedPaper(paperAId), null);
    await page.locator('button[title="Open library"]').click();
    await page.setViewportSize({ width: 980, height: 620 });
    const unavailableA = page.locator('.library-entry').filter({ hasText: 'Recently edited A' });
    assert.equal(await unavailableA.getAttribute('data-workspace-available'), 'false');
    await unavailableA.getByText('Saved workspace unavailable · Reimport the original', { exact: false }).waitFor();
    await unavailableA.locator('.modal-list-row').click();
    await page.getByRole('alert').getByText(unreadableMessage, { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Paper Library', exact: true }).waitFor();
    assert.equal(await page.locator('.modal-list-row').count(), 2);
    const unavailableBounds = await unavailableA.evaluate(row => {
      const edit = row.querySelector('.icon-button').getBoundingClientRect();
      return { left: edit.left, right: edit.right, top: edit.top, bottom: edit.bottom, width: innerWidth, height: innerHeight,
        overflow: row.scrollWidth > row.clientWidth + 1 };
    });
    assert.ok(unavailableBounds.left >= 0 && unavailableBounds.right <= unavailableBounds.width && unavailableBounds.top >= 0 && unavailableBounds.bottom <= unavailableBounds.height);
    assert.equal(unavailableBounds.overflow, false, 'The unavailable status must not push the edit action out of its row');
    await page.screenshot({ path: path.join(workspace, 'unavailable-library-980.png'), timeout: 5000 });
    await page.setViewportSize({ width: 1320, height: 820 });
    assert.equal(await page.locator('.title-wrap h1').textContent(), b.name, 'Failed opens retain the currently displayed paper');
    assert.equal(JSON.parse(fs.readFileSync(lastPaperFile, 'utf8')).id, paperBId);
    assert.deepEqual(bodyFiles(paperAId), corruptedA);
    await editLabel('Recently edited A', 'Recovery label A', 'recover, 保留, recover', 'delayed');
    assert.deepEqual(bodyFiles(paperAId), corruptedA, 'Editing an unreadable entry must not replace either damaged body file');
    assert.equal(libraryIndex().entries[paperAId].libraryTitle, 'Recovery label A');
    assert.deepEqual(libraryIndex().entries[paperAId].tags, ['recover', '保留']);
    assert.equal(libraryIndex().entries[paperAId].updatedAt, a.updatedAt);
    await page.getByPlaceholder('Search titles and tags').fill('保留');
    assert.equal(await page.locator('.modal-list-row').count(), 1);
    await page.locator('.modal-list-row').getByText('Recovery label A', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await close();
    stages.push('Real primary+backup corruption retains library entry and current paper; unavailable labels remain editable without body writes');

    await launch();
    await page.getByRole('heading', { name: b.name, exact: true }).waitFor({ timeout: 20000 });
    snapshot = await librarySnapshot();
    const unavailable = snapshot.library.find(item => item.id === paperAId);
    assert.equal(unavailable.name, 'Recovery label A');
    assert.deepEqual(unavailable.tags, ['recover', '保留']);
    assert.equal(unavailable.workspaceAvailable, false);
    assert.equal(snapshot.library.length, 2);
    assert.deepEqual(bodyFiles(paperAId), corruptedA);
    await page.locator('button[title="Open library"]').click();
    const retained = page.locator('.library-entry').filter({ hasText: 'Recovery label A' });
    assert.equal(await retained.getAttribute('data-workspace-available'), 'false');
    await retained.locator('.modal-list-row').click();
    await page.getByRole('alert').getByText(unreadableMessage, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close dialog' }).click();

    // Reimport the exact original text through real UI, resolving the same SHA-256.
    await (await openPasteText(page)).fill(paperAText);
    assert.equal(await loadPastedText(page, { view: 'Paper' }), paperAId);
    await page.getByRole('heading', { name: 'Pasted Text', exact: true }).waitFor();
    await page.locator('.document-preview').getByText(a.blocks[1].text, { exact: false }).waitFor();
    await waitFor(async () => (await librarySnapshot()).library.find(item => item.id === paperAId)?.workspaceAvailable === true, 'original text reimport to restore the existing entry');
    const recovered = await loadedPaper(paperAId);
    assert.equal(recovered.name, 'Pasted Text');
    assert.equal(recovered.libraryTitle, 'Recovery label A');
    assert.deepEqual(recovered.tags, ['recover', '保留']);
    assert.deepEqual(recovered.blocks.map(block => block.text), a.blocks.map(block => block.text));
    assert.equal((await librarySnapshot()).library.length, 2, 'Recovery updates the original entry instead of creating a duplicate');
    await page.locator('.library-row').first().getByText('Recovery label A', { exact: true }).waitFor();
    await close();
    await launch();
    await page.getByRole('heading', { name: 'Pasted Text', exact: true }).waitFor({ timeout: 20000 });
    const restarted = await loadedPaper(paperAId);
    assert.equal(restarted.libraryTitle, 'Recovery label A');
    assert.deepEqual(restarted.tags, ['recover', '保留']);
    assert.deepEqual(restarted.blocks.map(block => block.text), a.blocks.map(block => block.text));
    snapshot = await librarySnapshot();
    assert.equal(snapshot.library.find(item => item.id === paperAId).workspaceAvailable, true);
    assert.equal(snapshot.library.length, 2);
    assert.deepEqual(bodyFiles(paperBId), beforeLabelB, 'Recovering another paper must not rewrite the labeled legacy paper');
    stages.push('Unreadable labels survive full restart; genuine same-text UI reimport and another restart recover the same ID with index labels');
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error;
    console.error(error.stack);
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 5000 }).catch(cause => console.error(cause));
  } finally { await close().catch(error => { failure ||= error; }); }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'results.json'), JSON.stringify({ stages, errors, paperAId, paperBId }, null, 2));
  console.log(`Library verified: recency/progress, index-only labels, actual corruption, editable unavailable entries, same-text recovery and restarts. Artifacts: ${workspace}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
