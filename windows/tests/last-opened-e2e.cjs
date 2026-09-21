const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const paperAId = 'a'.repeat(64);
const paperBId = 'b'.repeat(64);

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (predicate()) return; } catch { /* IPC write may still be in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function paper(id, name, text, updatedAt) {
  return {
    id, name, type: 'text', createdAt: '2026-01-01T00:00:00.000Z', updatedAt,
    blocks: [{ id: 1, text: 'Abstract', heading: true, translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] },
      { id: 2, text, heading: false, translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] }],
    tags: [], summary: null, connectedTranslation: '', extraction: 'Pasted text',
    position: { block: 1, page: 1, tab: 'Paper', displayMode: 'bilingual' }
  };
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'last-opened-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected test workspace path');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  const papersDir = path.join(workspace, 'papers');
  fs.mkdirSync(papersDir, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ autoCheckUpdates: false, onboardingCompletedVersion: 1, ollamaBaseURL: 'http://127.0.0.1:9' }));
  const a = paper(paperAId, 'Recently edited A', 'Paper A contains the newer saved content.', '2099-01-01T00:00:00.000Z');
  const b = paper(paperBId, 'Last opened B', 'Paper B is the last paper opened without editing.', '2020-01-01T00:00:00.000Z');
  fs.writeFileSync(path.join(papersDir, `${paperAId}.json`), JSON.stringify(a));
  fs.writeFileSync(path.join(papersDir, `${paperBId}.json`), JSON.stringify(b));
  const lastPaperFile = path.join(workspace, 'last-paper.json');
  fs.writeFileSync(lastPaperFile, JSON.stringify({ id: paperBId }));

  const launch = () => electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('heading', { name: 'Last opened B' }).waitFor({ timeout: 20000 });
    assert.match(await page.locator('.document-preview').innerText(), /Paper B is the last paper opened/);
    assert.match(await page.locator('.library-row').first().innerText(), /Recently edited A/);

    await page.locator('.library-row').filter({ hasText: 'Recently edited A' }).click();
    await page.getByRole('heading', { name: 'Recently edited A' }).waitFor();
    await waitFor(() => JSON.parse(fs.readFileSync(lastPaperFile, 'utf8')).id === paperAId, 'A open marker');
    await page.locator('.library-row').filter({ hasText: 'Last opened B' }).click();
    await page.getByRole('heading', { name: 'Last opened B' }).waitFor();
    await waitFor(() => JSON.parse(fs.readFileSync(lastPaperFile, 'utf8')).id === paperBId, 'B open marker');

    await app.close(); app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('heading', { name: 'Last opened B' }).waitFor({ timeout: 20000 });
    assert.match(await page.locator('.document-preview').innerText(), /Paper B is the last paper opened/);
    assert.match(await page.locator('.library-row').first().innerText(), /Recently edited A/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(papersDir, `${paperAId}.json`), 'utf8')).blocks, a.blocks);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(papersDir, `${paperBId}.json`), 'utf8')).blocks, b.blocks);
    console.log('Last opened paper restored independently of library edit order and without changing paper content.');
  } finally { await app?.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
