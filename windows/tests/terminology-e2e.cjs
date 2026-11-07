const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function selectText(page, selector, text) {
  await page.evaluate(({ selector, text }) => {
    const root = document.querySelector(selector);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`Selection fixture missing ${text}`);
  }, { selector, text });
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'terminology-e2e-'));
  const glossaryFile = path.join(workspace, 'glossary.json');
  const readTerms = () => JSON.parse(fs.readFileSync(glossaryFile, 'utf8'));
  const entry = (source, target, sourceLanguage = 'English', targetLanguage = 'Simplified Chinese') =>
    ({ source, target, sourceLanguage, targetLanguage });
  const initialTerms = [entry('attention', '注意力'), entry('self-attention', '旧术语'),
    entry('自注意力', 'self-attention', 'Simplified Chinese', 'English'), entry('self-attention', 'attention propre', 'English', 'French')];
  fs.writeFileSync(glossaryFile, JSON.stringify(initialTerms));

  async function withWriteFailure(action) {
    const saved = `${glossaryFile}.test-preserve`;
    fs.renameSync(glossaryFile, saved);
    fs.mkdirSync(glossaryFile);
    try { await action(JSON.parse(fs.readFileSync(saved, 'utf8'))); }
    finally {
      fs.rmdirSync(glossaryFile);
      fs.renameSync(saved, glossaryFile);
    }
  }

  const model = 'translategemma:4b';
  const prompts = [];
  const ollama = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model }] }));
    if (request.url === '/api/ps') return response.end('{"models":[]}');
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    for await (const chunk of request) body += chunk;
    const { prompt } = JSON.parse(body);
    prompts.push(prompt);
    const answer = prompt.startsWith('Translate exactly and only') ? 'self-attention' : '此处使用自注意力。';
    response.end(JSON.stringify({ response: answer, done: true }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    onboardingCompletedVersion: 1, autoCheckUpdates: false, ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`
  }));
  const launch = () => electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  const dictionary = prompt => JSON.parse(prompt.split('\n').find(line => line.startsWith('[{"source":')));
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Paste Text', exact: true }).first().click();
    await page.locator('.paste-area').fill('Self-attention stabilizes the baseline attention score.');
    await page.getByRole('button', { name: 'Open text', exact: true }).click();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('#block-1 .source-text').waitFor();
    await selectText(page, '#block-1 .source-text', 'Self-attention');
    const draft = page.getByPlaceholder('Approved translation');
    await draft.fill(' 自注意机制 ');
    const save = page.getByRole('button', { name: 'Save term', exact: true });
    await withWriteFailure(async saved => {
      assert.deepEqual(saved, initialTerms);
      await save.click();
      await page.getByRole('alert').getByText(/Could not save the term/).waitFor();
      assert.equal(await draft.inputValue(), ' 自注意机制 ');
      assert.equal(await page.getByText('Term saved for future translations.', { exact: true }).count(), 0);
    });
    await save.click();
    await page.getByText('Term saved for future translations.', { exact: true }).waitFor();
    assert.deepEqual(readTerms(), [initialTerms[0], initialTerms[2], initialTerms[3], entry('Self-attention', '自注意机制')]);

    await page.locator('#block-1').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
    const translation = page.locator('#block-1 .translation-text.done');
    await translation.waitFor();
    const forward = [{ source: 'Self-attention', translation: '自注意机制' }, { source: 'attention', translation: '注意力' }];
    assert.deepEqual(dictionary(prompts[0]), forward);
    await selectText(page, '#block-1 .translation-text', '自注意力');
    await page.locator('.inspector').getByRole('button', { name: 'Translate', exact: true }).click();
    await page.getByText('Selection translated.', { exact: true }).waitFor();
    assert.deepEqual(dictionary(prompts[1]), [{ source: '自注意力', translation: 'self-attention' }]);
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
    await page.getByText('Connected full-paper translation saved.', { exact: true }).waitFor();
    assert.match(prompts[2], /Paper excerpt:/);
    assert.deepEqual(dictionary(prompts[2]), forward);

    await page.getByRole('button', { name: 'Saved Terminology', exact: true }).click();
    await page.getByPlaceholder('Search saved terms').fill('  自注意机制 ');
    const termRow = page.locator('.term-row');
    await termRow.getByText('Self-attention', { exact: true }).waitFor();
    const remove = termRow.getByRole('button', { name: 'Remove Self-attention' });
    await withWriteFailure(async saved => {
      assert.equal(saved.length, 4);
      await remove.click();
      await page.getByRole('alert').getByText(/Could not remove the term/).waitFor();
      assert.equal(await termRow.count(), 1);
    });
    await remove.click();
    await termRow.waitFor({ state: 'detached' });
    assert.equal(readTerms().length, 3);
    await app.close(); app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    assert.match(await page.locator('#block-1 .translation-text.done').innerText(), /此处使用自注意力/);
    await page.getByRole('button', { name: 'Saved Terminology', exact: true }).click();
    assert.equal(await page.locator('.term-row').count(), 3);
    console.log('Terminology verified: durable save and removal, failure and retry, longest match, reverse selection, full translation and unchanged saved output after restart.');
  } finally {
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
