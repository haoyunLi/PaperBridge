// Use a temporary trusted certificate inside the test process and a real AMD Ollama service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { observeLocalOllama } = require('./observe-local-ollama.cjs');
const { localTestCertificate } = require('./local-test-certificate.cjs');
const { openWorkspaceView, openPasteText, loadPastedText } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(root, 'test-artifacts', 'secure-local-model-'));
  const cert = await localTestCertificate(), proxy = await observeLocalOllama('http://127.0.0.1:11434', { identity: cert.server, prefix: '/papers/local' });
  const model = 'translategemma:4b', exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1 }));
  const launch = () => electron.launch({ ...(exe && { executablePath: exe }), cwd: root, args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  const trust = app => app.evaluate((_electron, pem) => {
    const tls = process.getBuiltinModule('node:tls');
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), pem]);
    return tls.getCACertificates('system').length;
  }, cert.pem);
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await assert.rejects(page.evaluate(url => window.paperBridge.listModels(url), proxy.url), /certificate could not be verified/);
    const systemRoots = await trust(app);
    assert.ok(systemRoots > 0);
    await assert.rejects(page.evaluate(url => window.paperBridge.listModels(url), proxy.url.replace('papers.localhost', 'other.localhost')), /certificate could not be verified/);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Models', exact: true }).click();
    await page.getByLabel('Ollama URL', { exact: true }).fill(proxy.url);
    await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
    await page.waitForFunction(async url => (await window.paperBridge.listModels(url)).includes('translategemma:4b'), proxy.url);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await openPasteText(page);
    await page.locator('.paste-area').fill('The solar panel supplied power to the temperature sensor. The researchers recorded the temperature every hour.');
    await loadPastedText(page, { view: 'Reader' });
    await page.locator('#block-1').getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
    const result = page.locator('#block-1 .translation-text.done');
    await result.waitFor({ timeout: 120000 });
    const translation = await result.innerText();
    assert.match(translation, /温度/);
    const loaded = await page.evaluate(url => window.paperBridge.runningModels(url), proxy.url);
    assert.ok(proxy.routes.has('/papers/local/api/ps'));
    assert.ok(proxy.routes.has('/papers/local/api/tags'));
    assert.equal(proxy.calls.length, 1);
    assert.ok(proxy.routes.has('/papers/local/api/generate'));
    assert.ok((await (await fetch('http://127.0.0.1:11434/api/ps')).json()).models.find(m => m.name === model)?.size_vram > 0);
    await app.close(); app = await launch(); await trust(app);
    page = await app.firstWindow();
    await openWorkspaceView(page, 'Reader');
    await page.locator('#block-1 .translation-text.done').getByText(translation, { exact: true }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).ollamaBaseURL, proxy.url);
    console.log(JSON.stringify({ dir, systemRoots, paths: [...proxy.routes], translation, loaded }));
  } finally { await app.close(); await proxy.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
