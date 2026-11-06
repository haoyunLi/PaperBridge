const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* settings may still be saving */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  const workspace = path.join(artifacts, 'openai-settings-workspace');
  if (!workspace.startsWith(artifacts + path.sep)) throw new Error('Unexpected OpenAI test workspace');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({ onboardingCompletedVersion: 1, autoCheckUpdates: false }));
  const keyFile = path.join(workspace, 'openai-key.bin');
  const apiKey = 'paperbridge-e2e-api-key-placeholder';
  let app;
  let page;

  async function launch() {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await app.firstWindow();
    await page.locator('.header').waitFor({ timeout: 20000 });
  }
  async function openModels() {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Models', exact: true }).click();
  }

  try {
    await launch();
    await openModels();
    await page.getByLabel('AI provider').selectOption('openai');
    await page.getByLabel('New OpenAI API key').fill(apiKey);
    await page.getByRole('button', { name: 'Save key', exact: true }).click();
    await page.getByText('Key saved for this Windows account', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('New OpenAI API key').inputValue(), '');
    assert.equal(fs.existsSync(keyFile), true);
    assert.equal(fs.readFileSync(keyFile).includes(Buffer.from(apiKey)), false, 'The API key must not be stored as plaintext');
    await page.getByLabel('I allow this text to be sent to OpenAI for this session').check();
    await page.getByText('OpenAI text access is enabled for this app session.', { exact: true }).waitFor();
    assert.equal(await page.locator('.service').textContent(), '● OpenAI Online');
    await page.getByLabel('Translation model ID').fill('gpt-translation-fixture');
    await page.getByRole('button', { name: 'Use translation model for all tasks', exact: true }).click();
    await page.getByRole('tab', { name: 'Reading', exact: true }).click();
    await page.getByLabel('Optional translation instructions').fill('Use concise academic Chinese.');
    await waitFor(() => {
      const saved = JSON.parse(fs.readFileSync(path.join(workspace, 'settings.json'), 'utf8'));
      return saved.aiProvider === 'openai' && saved.openAIQuickLookupModel === 'gpt-translation-fixture' && saved.translationStyleGuide === 'Use concise academic Chinese.';
    }, 'OpenAI settings save');
    const savedText = fs.readFileSync(path.join(workspace, 'settings.json'), 'utf8');
    assert.doesNotMatch(savedText, /paperbridge-e2e-api-key|openAIConsent|isOpenAIOptInConfirmed/);
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await app.evaluate(({ ipcMain }) => {
      globalThis.__paperBridgeOpenAIRequests = [];
      ipcMain.removeHandler('openai:generate');
      ipcMain.handle('openai:generate', (_event, payload) => {
        globalThis.__paperBridgeOpenAIRequests.push(payload);
        return '在线测试译文';
      });
    });
    await page.getByRole('button', { name: 'Try a Practice Paper', exact: true }).first().click();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    const firstBlock = page.locator('#block-1');
    await firstBlock.getByTitle('Translate heading').click();
    await firstBlock.getByText('在线测试译文', { exact: true }).waitFor();
    const requests = await app.evaluate(() => globalThis.__paperBridgeOpenAIRequests);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'gpt-translation-fixture');
    assert.match(requests[0].prompt, /complete academic item/);
    assert.match(requests[0].system, /Document title.*Welcome to PaperBridge/);
    assert.match(requests[0].system, /Use concise academic Chinese/);

    await app.evaluate(({ ipcMain }) => {
      globalThis.__paperBridgeOpenAIRequests = [];
      ipcMain.removeHandler('openai:generate');
      ipcMain.handle('openai:generate', (_event, payload) => {
        globalThis.__paperBridgeOpenAIRequests.push(payload);
        return 'expanded context '.repeat(12);
      });
    });
    await page.locator('#block-2 .source-text').evaluate(element => {
      const range = document.createRange();
      range.setStart(element.firstChild, 0);
      range.setEnd(element.firstChild, element.textContent.indexOf('.') + 1);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const inspector = page.locator('.inspector');
    await inspector.getByRole('button', { name: 'Translate', exact: true }).click();
    await inspector.getByRole('alert').filter({ hasText: 'The model expanded the selection instead of translating it. Retry with another model.' }).waitFor();
    const selectionRequests = await app.evaluate(() => globalThis.__paperBridgeOpenAIRequests);
    assert.equal(selectionRequests.length, 1, 'One selection click must not trigger a billable retry');
    assert.match(selectionRequests[0].prompt, /PAPERBRIDGE_CONTEXT_DO_NOT_TRANSLATE/);
    assert.equal(await inspector.locator('.inspector-result.translate').count(), 0, 'An overexpanded OpenAI answer must not be displayed as a translation');
    await page.keyboard.press('Escape');

    // Revoking online consent while a multi-block pass is waiting must cancel
    // the renderer task and prevent the next paragraph from being submitted.
    await app.evaluate(({ ipcMain }) => {
      globalThis.__paperBridgeOpenAIRequests = [];
      globalThis.__paperBridgeReleaseDelayedRequest = null;
      ipcMain.removeHandler('openai:generate');
      ipcMain.handle('openai:generate', (_event, payload) => {
        globalThis.__paperBridgeOpenAIRequests.push(payload);
        return new Promise(resolve => { globalThis.__paperBridgeReleaseDelayedRequest = () => resolve('不得保存的迟到译文'); });
      });
    });
    await page.getByRole('button', { name: 'Resume Translation', exact: true }).click();
    await waitFor(async () => (await app.evaluate(() => globalThis.__paperBridgeOpenAIRequests.length)) === 1, 'delayed OpenAI request');
    await openModels();
    const consent = page.getByLabel('I allow this text to be sent to OpenAI for this session');
    await consent.uncheck();
    await page.getByText('OpenAI text access is paused.', { exact: true }).waitFor();
    await app.evaluate(() => globalThis.__paperBridgeReleaseDelayedRequest());
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Set up translation', exact: true }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.__paperBridgeOpenAIRequests.length), 1, 'Consent revocation must stop the remaining queue');
    assert.equal(await page.getByText('不得保存的迟到译文', { exact: true }).count(), 0, 'A cancelled late response must be discarded');

    // A provider-wide authorization/quota/model failure is not a paragraph
    // error: the batch must stop after one request instead of repeating it.
    await openModels();
    await consent.check();
    await page.getByText('OpenAI text access is enabled for this app session.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await app.evaluate(({ ipcMain }) => {
      globalThis.__paperBridgeOpenAIRequests = [];
      ipcMain.removeHandler('openai:generate');
      ipcMain.handle('openai:generate', (_event, payload) => {
        globalThis.__paperBridgeOpenAIRequests.push(payload);
        throw new Error('OpenAI rate or usage limit was reached. Review usage and billing, then retry.');
      });
    });
    await page.getByRole('button', { name: 'Resume Translation', exact: true }).click();
    await page.locator('.notice.error').filter({ hasText: 'OpenAI rate or usage limit was reached. Review usage and billing, then retry.' }).waitFor();
    await page.getByRole('button', { name: 'Resume Translation', exact: true }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.__paperBridgeOpenAIRequests.length), 1, 'A global OpenAI failure must stop the remaining queue');

    await openModels();
    await page.getByLabel('AI provider').selectOption('ollama');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await firstBlock.getByText('Translation pending', { exact: false }).waitFor();
    await openModels();
    await page.getByLabel('AI provider').selectOption('openai');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await firstBlock.getByText('在线测试译文', { exact: true }).waitFor();
    await app.close(); app = null;

    const legacyId = 'a'.repeat(64);
    fs.writeFileSync(path.join(workspace, 'papers', `${legacyId}.json`), JSON.stringify({
      id: legacyId, name: 'Legacy local paper', type: 'text', updatedAt: new Date().toISOString(),
      taskSettings: { translationModel: 'legacy-local-model', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' },
      position: { tab: 'Reader', block: 1 },
      blocks: [{ id: 1, text: 'This paper predates provider settings.', translation: '旧版本地译文', status: 'ok' }]
    }));
    await launch();
    const legacyBlock = page.locator('#block-1');
    assert.equal(await page.locator('.service').textContent(), '● OpenAI Paused');
    await page.getByRole('button', { name: 'Set up translation', exact: true }).click();
    const modelsTab = page.getByRole('tab', { name: 'Models', exact: true });
    await modelsTab.waitFor();
    assert.equal(await modelsTab.getAttribute('aria-selected'), 'true');
    await page.getByText('Allow sending text to OpenAI for this session in Settings > Models.').waitFor();
    await page.getByText('Key saved for this Windows account', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('I allow this text to be sent to OpenAI for this session').isChecked(), false, 'Online consent must not survive restart');
    assert.equal(await page.getByLabel('Translation model ID').inputValue(), 'gpt-translation-fixture');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-1').getByText('在线测试译文', { exact: true }).waitFor();
    await page.locator('.library-row').getByText('Legacy local paper', { exact: true }).click();
    await legacyBlock.getByText('This paper predates provider settings.', { exact: true }).waitFor();
    await legacyBlock.getByText('Translation pending', { exact: false }).waitFor();
    await openModels();
    await page.getByLabel('AI provider').selectOption('ollama');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await legacyBlock.getByText('旧版本地译文', { exact: true }).waitFor();
    await openModels();
    await page.getByLabel('AI provider').selectOption('openai');
    await page.getByLabel('I allow this text to be sent to OpenAI for this session').check();
    await page.getByText('OpenAI text access is enabled for this app session.', { exact: true }).waitFor();
    // Omitting the request ID safely probes the real main-process gate before
    // any network call. The error changes only when the gate is closed.
    const probeConsent = () => page.evaluate(() => window.paperBridge.generateOpenAI({}).catch(error => error.message));
    assert.match(await probeConsent(), /Invalid OpenAI request/);
    await page.getByRole('tab', { name: 'Local Data', exact: true }).click();
    await page.getByRole('button', { name: 'Remove all saved PaperBridge data…', exact: true }).click();
    await page.getByRole('button', { name: 'Remove saved data', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await waitFor(() => JSON.parse(fs.readFileSync(path.join(workspace, 'settings.json'), 'utf8')).aiProvider === 'ollama', 'local settings reset');
    assert.equal(fs.existsSync(keyFile), true, 'Clearing workspaces must retain the separately managed API key');
    assert.match(await probeConsent(), /Nothing was sent/, 'Clearing workspaces must revoke main-process online consent');
    await openModels();
    await page.getByLabel('AI provider').selectOption('openai');
    await page.getByText('Key saved for this Windows account', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remove key', exact: true }).click();
    await page.getByText('No saved API key', { exact: true }).waitFor();
    assert.equal(fs.existsSync(keyFile), false);
    console.log('OpenAI settings verified: DPAPI key, explicit models, single-request selection, consent cancellation, quota stop, legacy variants, restart and data-clear revocation.');
  } finally {
    if (app) await app.close().catch(() => {});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
