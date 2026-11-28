const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

const root = path.resolve(__dirname, '..');
const fixture = name => fs.readFileSync(path.join(__dirname, 'mac-parity', name));
const pdf = fixture('emcee-v3.pdf');
const id = crypto.createHash('sha256').update(pdf).digest('hex');
const markdown = fixture('range-article.md').toString('utf8');
const model = 'translategemma:4b';
const live = process.env.PAPERBRIDGE_TEST_RANGE_OLLAMA === '1';

async function run() {
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'range-actions-'));
  const prompts = [];
  const service = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: model }] }));
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/generate') { response.writeHead(404); return response.end('{}'); }
    let body = '';
    for await (const chunk of request) body += chunk;
    prompts.push(JSON.parse(body).prompt);
    response.end(JSON.stringify({ done: true, response: '已经完成这段的翻译。' }));
  });
  if (!live) await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + (live ? 11434 : service.address().port);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ onboardingCompletedVersion: 1, autoCheckUpdates: false,
    pdfExtractionMode: 'mineruOnly', ollamaBaseURL: endpoint, translationModel: model, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ executablePath, args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')],
    cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.locator('.welcome').waitFor();
    await app.evaluate(({ ipcMain }, markdown) => {
      ipcMain.removeHandler('mineru:status');
      ipcMain.handle('mineru:status', () => ({ compatible: true, executable: 'range-parser', version: 'fixture' }));
      ipcMain.removeHandler('mineru:extract');
      ipcMain.handle('mineru:extract', () => ({ markdown, pageHints: [] }));
    }, markdown);
    await page.evaluate(encoded => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'emcee-v3.pdf', { type: 'application/pdf' }));
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, pdf.toString('base64'));
    await page.getByRole('heading', { name: 'emcee-v3.pdf', exact: true }).waitFor();
    await openWorkspaceView(page, 'Reader');
    const file = path.join(dir, 'papers', id + '.json');
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const waitForSave = async predicate => {
      const deadline = Date.now() + (live ? 180000 : 15000);
      while (Date.now() < deadline) {
        if (fs.existsSync(file) && predicate(read())) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Expected paper state was not saved. Current blocks: ' + JSON.stringify(read().blocks.map(b => [b.id, b.status, b.error])));
    };
    await waitForSave(paper => paper.sourceMode === 'mineru');
    const blocks = read().blocks;
    const blockId = text => {
      const block = blocks.find(b => b.text === text);
      assert.ok(block, text);
      return block.id;
    };
    const selected = blockId('Three sensors were calibrated before the experiment.');
    const resource = blocks.find(b => b.resource).id;
    await page.locator('#block-' + selected + ' .source-text').click();
    await waitForSave(paper => paper.selectedParagraphID === selected);
    const at = async block => {
      await page.locator('#block-' + block).evaluate(element => {
        const host = element.closest('.main-scroll');
        host.scrollTop += element.getBoundingClientRect().top - host.getBoundingClientRect().top + 2;
      });
      await page.getByRole('button', { name: 'Choose translation range', exact: true }).click();
    };
    const range = () => page.getByRole('dialog', { name: 'Translation range' });
    const current = () => range().getByRole('button', { name: /^Current section:/ });
    const close = () => range().getByRole('button', { name: 'Close dialog' }).click();
    const title = async () => (await current().innerText()).replace(/^Current section:\s*/,'').replace(/\s*\d+ blocks?\s*$/, '').trim();
    const result = {};
    await at(blockId('Results'));
    result.paragraphSection = await title();
    assert.equal(result.paragraphSection, 'Results');
    await close();
    await at(resource);
    result.resourceSection = await title();
    assert.equal(result.resourceSection, 'Abstract', 'with the table at the top, use the selected paragraph’s section');
    const done = paper => paper.blocks.filter(b => b.status === 'ok' && b.translation).map(b => b.text);
    const checkAction = async (button, expectedNew, completedBefore) => {
      assert.equal(await button.isEnabled(), true);
      assert.match(await button.innerText(), new RegExp(expectedNew.length + ' (unfinished )?blocks?$'));
      const before = prompts.length;
      await button.click();
      const expected = new Set([...completedBefore, ...expectedNew]);
      await waitForSave(paper => done(paper).length === expected.size);
      const saved = read();
      const completed = done(saved);
      assert.deepEqual(new Set(completed), expected);
      assert.equal(saved.selectedParagraphID, selected);
      if (!live) {
        const requests = prompts.slice(before);
        assert.equal(requests.length, expectedNew.length, 'one request per newly translated block');
        expectedNew.forEach((text, i) => {
          const block = blocks.find(b => b.text === text);
          assert.ok(requests[i].endsWith('\n' + (block.sourceMarkdown || text)), 'model input for ' + text);
        });
      }
      for (const b of saved.blocks.filter(b => expected.has(b.text))) assert.match(b.translation, /[\u3400-\u9fff]/u);
      return completed;
    };
    const abstract = ['Abstract', blocks.find(b => b.id === selected).text];
    result.afterCurrent = await checkAction(current(), abstract, []);
    await at(resource);
    assert.equal(await current().isDisabled(), true);
    result.afterOverview = await checkAction(range().getByRole('button', { name: /^Abstract & Conclusion/ }),
      ['Conclusions', 'Independent calibration improved repeatability across the three sensors.'], result.afterCurrent);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.locator('#block-' + selected).waitFor();
    result.restored = done(read());
    assert.deepEqual(result.restored, result.afterOverview);
    await at(resource);
    assert.equal(await title(), 'Abstract');
    assert.equal(await range().getByRole('button', { name: /^Abstract & Conclusion/ }).isDisabled(), true);
    result.afterChosen = await checkAction(range().getByRole('button', { name: /^Choose section: Methods/ }),
      ['Methods', 'We tested each sensor in a temperature chamber.', 'Each chamber was checked against an independent thermometer.'], result.restored);
    const saved = read();
    assert.ok(saved.blocks.filter(b => b.resource || /Journal of Measurement|^References$/.test(b.text)).every(b => !b.translation));
    if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
      const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8'));
      assert.deepEqual(result, native.translationRangeActions, 'the same range actions on the native Mac view model');
    }
    let modelVRAM;
    if (live) {
      const usage = await (await fetch(endpoint + '/api/ps')).json();
      modelVRAM = usage.models.find(m => m.name === model)?.size_vram;
      assert.ok(modelVRAM > 0, 'the local translation model used GPU memory');
    }
    console.log(JSON.stringify({ dir, result, modelVRAM, example: saved.blocks.find(b => b.id === selected).translation }));
  } finally {
    await app?.close();
    if (!live) { service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
