const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');
const passages = require('./mac-parity/long-pdf-selections.json');

async function selectPassage(page, passage) {
  for (const number of [passage.first, passage.last]) {
    await page.locator('.textLayer[data-page="' + number + '"] span').first().waitFor();
  }
  return page.locator('.pdf-continuous').evaluate((host, passage) => {
    function endpoint(number, marker, after) {
      const layer = host.querySelector('.textLayer[data-page="' + number + '"]');
      const index = layer.textContent.indexOf(marker);
      if (index < 0 || index !== layer.textContent.lastIndexOf(marker)) throw Error('Expected a unique boundary: ' + marker);
      let remaining = index + (after ? marker.length : 0);
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (remaining < node.length || (after && remaining === node.length)) return [node, remaining];
        remaining -= node.length;
      }
      throw Error('Missing text node for ' + marker);
    }
    const range = document.createRange();
    range.setStart(...endpoint(passage.first, passage.start, false));
    range.setEnd(...endpoint(passage.last, passage.end, true));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return range.toString().length;
  }, passage);
}

async function checkLiveTranslation(app, page, quote, model, baseURL, dir) {
  await app.evaluate(() => {
    const generate = global.fetch;
    global.longSelectionRequests = [];
    global.fetch = (url, options) => {
      if (new URL(url).pathname === '/api/generate' && typeof options?.body === 'string') {
        global.longSelectionRequests.push(JSON.parse(options.body).prompt);
      }
      return generate(url, options);
    };
  });
  const inspector = page.locator('.inspector');
  const translate = inspector.getByRole('button', { name: 'Translate', exact: true });
  const started = Date.now();
  await translate.click();
  await inspector.getByText('Selection translated.', { exact: true }).waitFor({ timeout: 180000 });
  const translation = await inspector.locator('.inspector-result.translate p').innerText();
  const prompts = await app.evaluate(() => global.longSelectionRequests);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].includes('<<<PAPERBRIDGE_SELECTION_TRANSLATE_ONLY>>>\n' + quote + '\n<<<END_PAPERBRIDGE_SELECTION>>>'));
  assert.match(translation, /\p{Script=Han}/u);
  const active = (await (await fetch(baseURL + '/api/ps')).json()).models.find(entry => entry.name === model || entry.model === model);
  assert.ok(active?.size_vram > 0);
  await translate.click();
  await inspector.getByText('Using cached quick lookup.', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => global.longSelectionRequests.length), 1);
  fs.writeFileSync(path.join(dir, 'translation.json'), JSON.stringify({ model, vram: active.size_vram,
    seconds: (Date.now() - started) / 1000, source: quote, translation }, null, 2));
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'long-pdf-notes-'));
  const pdf = path.join(__dirname, 'mac-parity', 'good-enough', 'article.pdf');
  const live = process.argv.includes('--live-translation');
  const model = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
  const baseURL = live ? process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434' : 'http://127.0.0.1:9';
  const env = { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, pdfExtractionMode: 'pdfOnly',
    inspectorOpen: true, onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: baseURL,
    sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', quickLookupModel: model }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ ...(exe && { executablePath: exe }), cwd: root, env,
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')] });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, pdf);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).first().click();
    await page.getByRole('heading', { name: 'article.pdf', exact: true }).waitFor({ timeout: 60000 });
    await openWorkspaceView(page, 'Original');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    const saved = path.join(dir, 'papers', fs.readdirSync(path.join(dir, 'papers')).find(name => name.endsWith('.json')));
    const observed = {};
    for (const item of passages) {
      const length = await selectPassage(page, item);
      assert.ok(length > 3000, 'Expected a full-length paper quotation');
      const inspector = page.locator('.inspector');
      await inspector.locator('blockquote').filter({ hasText: item.start }).waitFor({ timeout: 6000 });
      const quote = await inspector.locator('blockquote').first().textContent();
      assert.ok(quote.startsWith(item.start) && quote.endsWith(item.end), item.name);
      assert.ok(await inspector.locator('.inspector-quote-text').evaluate(element => {
        const line = Number.parseFloat(getComputedStyle(element).lineHeight);
        return element.clientHeight <= 8 * line + 1 && element.scrollHeight > element.clientHeight;
      }), 'The full quotation should fit behind the eight-line inspector preview');
      if (live && item === passages[0]) await checkLiveTranslation(app, page, quote, model, baseURL, dir);
      await inspector.locator('.highlight.amber').click();
      await page.getByLabel('Note for selected passage').fill(item.name);
      await page.getByRole('button', { name: 'Save note', exact: true }).click();
      await page.waitForFunction(async ({ id, body }) => {
        const doc = await window.paperBridge.loadPaper(id);
        return doc.pdfNotes?.some(note => note.body === body);
      }, { id: path.basename(saved, '.json'), body: item.name });
      const doc = JSON.parse(fs.readFileSync(saved));
      const note = doc.pdfNotes.find(record => record.body === item.name);
      assert.equal(note.quote ?? note.text, quote);
      const pages = note.anchors.map(anchor => anchor.page);
      assert.deepEqual(pages, Array.from({ length: item.last - item.first + 1 }, (_, i) => item.first + i));
      if (pages.length > 1) assert.ok(note.anchors.every(anchor => anchor.text.length < 3000));
      assert.ok(doc.pdfHighlights.some(mark => JSON.stringify(mark.anchors) === JSON.stringify(note.anchors)));
      observed[item.name] = pages;
    }
    const exported = path.join(dir, 'long-quotations.md');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, exported);
    await page.getByRole('button', { name: 'More ···', exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: 'Export Options…', exact: true }).click();
    await page.getByRole('button', { name: 'Summary, sources and notes', exact: true }).click();
    await page.getByText(/^Exported .*long-quotations\.md$/).waitFor();
    const markdown = fs.readFileSync(exported, 'utf8');
    for (const note of JSON.parse(fs.readFileSync(saved)).pdfNotes) {
      assert.ok(markdown.includes('> ' + (note.quote ?? note.text).replace(/\r?\n/g, '\n> ')));
      assert.ok(markdown.includes('Note: ' + note.body));
    }
    const reference = process.env.PAPERBRIDGE_MAC_REFERENCE;
    if (reference) assert.deepEqual(observed, JSON.parse(fs.readFileSync(reference)).longPDFSelections);
    await app.close();
    app = await launch(); page = await app.firstWindow();
    for (const item of passages) {
      await openWorkspaceView(page, 'Reader');
      await page.locator('.annotation-row').filter({ hasText: item.name }).getByRole('button').first().click();
      await page.waitForFunction(({ start, end }) => {
        const text = window.getSelection()?.toString();
        return text?.length > 3000 && text.startsWith(start) && text.endsWith(end);
      }, item, { timeout: 8000 });
      assert.equal(await page.getByLabel('Note for selected passage').inputValue(), item.name);
    }
    await app.close();
    const edited = JSON.parse(fs.readFileSync(saved));
    const damaged = edited.pdfNotes.find(note => note.body === passages[1].name);
    damaged.anchors[1].offset++;
    fs.writeFileSync(saved, JSON.stringify(edited));
    app = await launch(); page = await app.firstWindow();
    await page.locator('.annotation-row').filter({ hasText: damaged.body }).getByRole('button').first().click();
    await page.waitForFunction(async ({ paperId, noteId }) => {
      const paper = await window.paperBridge.loadPaper(paperId);
      return paper?.pdfNotes?.find(note => note.id === noteId)?.needsReview === true;
    }, { paperId: edited.id, noteId: damaged.id });
    const preserved = JSON.parse(fs.readFileSync(saved)).pdfNotes.find(note => note.id === damaged.id);
    assert.equal(preserved.body, damaged.body);
    assert.deepEqual(preserved.anchors, damaged.anchors);
    console.log(JSON.stringify({ dir, pages: observed, comparedWithMac: Boolean(reference) }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
