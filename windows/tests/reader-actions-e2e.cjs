const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function bounded(label, operation, timeout = 10000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await bounded(label, Promise.resolve().then(predicate), Math.max(1, deadline - Date.now()))) return; }
    catch { /* Atomic saves may briefly move the file. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function selectText(page, selector, quote) {
  await bounded(`select text in ${selector}`, page.locator(selector).evaluate((root, quote) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent.indexOf(quote);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + quote.length);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error('Missing selection fixture');
  }, quote));
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'reader-actions-'));
  let phase = 'fixture setup';
  const progress = message => {
    const line = `${new Date().toISOString()} [reader-actions] ${message}`;
    console.log(line);
    fs.appendFileSync(path.join(workspace, 'progress.log'), `${line}\n`);
  };
  const stage = value => { phase = value; progress(`BEGIN ${phase}`); };
  stage('fixture setup');
  fs.mkdirSync(path.join(workspace, 'papers'));
  const id = crypto.createHash('sha256').update('Reader action parity fixture').digest('hex');
  const structuredId = crypto.createHash('sha256').update('Reader action structured fixture').digest('hex');
  const requests = [];
  let mode = 'success', heldResponse, tagRequests = 0;
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      tagRequests++;
      return response.end(JSON.stringify({ models: [{ model: 'translategemma:4b' }] }));
    }
    if (request.url === '/api/ps') return response.end(JSON.stringify({ models: [] }));
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body);
      requests.push(payload);
      if (/Explain this whole academic paragraph/i.test(payload.system || '')) {
        return response.end(JSON.stringify({ response: 'Explanation of the selected full paragraph.', done: true }));
      }
      if (mode === 'hold') { heldResponse = response; return; }
      if (mode === 'failure') return response.end(JSON.stringify({ error: 'Intentional paragraph retry failure.' }));
      if (mode === 'markdown echo') {
        if (!payload.prompt?.includes('\nMarkdown block:\n')) {
          return response.end(JSON.stringify({ error: 'Missing Markdown request delimiter in the chunking fixture.' }));
        }
        return response.end(JSON.stringify({ response: payload.prompt.split('\nMarkdown block:\n').at(-1), done: true }));
      }
      response.end(JSON.stringify({ response: `新的段落译文 ${requests.length}。`, done: true }));
    });
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const settings = { ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, translationModel: 'translategemma:4b',
    explainModel: 'translategemma:4b', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese',
    autoCheckUpdates: false, onboardingCompletedVersion: 1, fontSize: 16, lineSpacing: 5, readingWidth: 920 };
  const originalBlocks = [
    { id: 1, text: 'Target paragraph reports a careful experiment with reproducible evidence.', translation: 'Saved first translation.', status: 'ok' },
    { id: 2, text: 'Results', heading: true, translation: '结果', status: 'ok' },
    { id: 3, text: 'Pending Heading With Enough Words To Wrap Beside Its Translation And Menu Actions', heading: true },
    { id: 4, text: 'Unrelated paragraph preserves its previously reviewed translation.', translation: 'Untouched reviewed translation.', status: 'ok' },
    { id: 5, text: 'This sentence explains the observations and states the limits of the controlled experiment. '.repeat(18) },
    { id: 6, text: 'Retained image resource', resource: true },
    { id: 7, text: 'The last paragraph closes the experiment and remains available for independent translation.' }
  ].map(block => ({ heading: false, translation: '', status: 'pending', bookmark: false,
    highlights: [], translationHighlights: [], notes: [], ...block }));
  const paper = { id, name: 'Reader actions fixture', type: 'text', sourceMode: 'text', extraction: 'Pasted text',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), inspectorOpen: false,
    blocks: originalBlocks, taskSettings: settings, position: { tab: 'Reader', block: 1, displayMode: 'bilingual' } };
  const protectedLongSource = 'word '.repeat(98) + '$E=mc^2$' + ' more'.repeat(10) +
    '!!! Wait... Preserve 🧬 and [the citation](https://example.org/paper).';
  const mineruBlocks = [
    { ...originalBlocks[1], id: 1, sourceMarkdown: '## Results' },
    { ...originalBlocks[0], id: 2, sourceMarkdown: originalBlocks[0].text },
    { ...originalBlocks[6], id: 3, text: protectedLongSource, sourceMarkdown: protectedLongSource }
  ];
  const structured = { ...paper, id: structuredId, name: 'Structured actions fixture', sourceMode: 'mineru',
    extraction: 'MinerU', blocks: mineruBlocks, mineruBlocks, mineruMarkdown: mineruBlocks.map(block => block.sourceMarkdown).join('\n\n'),
    taskSettings: { ...settings, maxParagraphChars: 500 } };
  const paperFile = paperId => path.join(workspace, 'papers', `${paperId}.json`);
  const readPaper = (paperId = id) => JSON.parse(fs.readFileSync(paperFile(paperId), 'utf8'));
  fs.writeFileSync(paperFile(id), JSON.stringify(paper));
  fs.writeFileSync(paperFile(structuredId), JSON.stringify(structured));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));

  let app, page, failure, result;
  const evaluate = (fn, value) => bounded(`${phase}: renderer evaluation`, page.evaluate(fn, value));
  const evaluateMain = (fn, value) => bounded(`${phase}: Electron evaluation`, app.evaluate(fn, value));
  const evaluateLocator = (locator, fn) => bounded(`${phase}: element evaluation`, locator.evaluate(fn));
  const windowState = () => bounded(`${phase}: window diagnostics`, app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), minimized: window.isMinimized(),
      focused: window.isFocused(), bounds: window.getBounds(), destroyed: window.isDestroyed() }))), 3000);
  const rendererState = () => bounded(`${phase}: renderer diagnostics`, page.evaluate(() => ({
    visibilityState: document.visibilityState, focused: document.hasFocus(), width: innerWidth, height: innerHeight,
    activeElement: document.activeElement?.outerHTML.slice(0, 500),
    status: document.querySelector('.save-status')?.textContent,
    openMenus: document.querySelectorAll('[role="menu"]:popover-open').length
  })), 3000);
  const closeElectron = async label => {
    if (!app) return;
    const ownedApp = app;
    const child = ownedApp.process();
    progress(`${label}: closing Electron pid=${child.pid}`);
    try {
      await bounded(`${label}: app.close`, ownedApp.close(), 15000);
      progress(`${label}: Electron closed`);
    } catch (error) {
      console.error(`[reader-actions] ${phase}: ${error.stack || error}`);
      const closeDiagnostics = { phase, windows: await windowState().catch(cause => ({ error: cause.message })),
        renderer: page && !page.isClosed() ? await rendererState().catch(cause => ({ error: cause.message })) : { closed: true } };
      console.error(`[reader-actions] Close diagnostics: ${JSON.stringify(closeDiagnostics)}`);
      fs.writeFileSync(path.join(workspace, 'close-diagnostics.json'), JSON.stringify(closeDiagnostics, null, 2));
      if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        progress(`${label}: terminating only owned Electron process tree pid=${child.pid}`);
        try {
          if (process.platform === 'win32') {
            await bounded(`${label}: owned Electron process termination`, new Promise((resolve, reject) => {
              execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 },
                cause => cause ? reject(cause) : resolve());
            }), 12000);
          } else child.kill('SIGKILL');
        } catch (cleanupError) { console.error(`[reader-actions] Owned process cleanup failed: ${cleanupError.stack || cleanupError}`); }
      }
      throw error; // A forced shutdown is a failed test, including during cleanup.
    } finally { app = null; }
  };
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded(`${phase}: firstWindow`, app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.locator('#block-1').waitFor({ timeout: 20000 });
    progress(`${phase}: launched pid=${app.process().pid} window=${JSON.stringify(await windowState())}`);
  };
  const block = number => page.locator(`#block-${number}`);
  const openMenu = async (number, heading = false) => {
    await block(number).getByRole('button', { name: heading ? 'Heading actions' : 'Paragraph actions', exact: true }).click();
    await page.getByRole('menu').waitFor();
  };
  const action = name => page.getByRole('menuitem', { name, exact: true });
  const bodyAction = async (number, name) => { await openMenu(number); await action(name).click(); };
  const closed = () => page.getByRole('menu').waitFor({ state: 'hidden' });
  const undo = () => page.locator('.reader-top .undo-button').click();
  const frames = async () => {
    progress(`${phase}: waiting for two animation frames`);
    await bounded(`${phase}: two animation frames`, page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))), 5000);
    progress(`${phase}: two animation frames complete`);
  };
  try {
    stage('launch and menu keyboard navigation');
    await launch();
    await waitFor(() => tagRequests > 0, 'local model discovery');
    const trigger = block(1).getByRole('button', { name: 'Paragraph actions', exact: true });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await page.getByRole('menu').waitFor();
    await waitFor(() => evaluateLocator(action('Translate This Paragraph'), node => node === document.activeElement), 'initial keyboard menu focus');
    await page.keyboard.press('End');
    assert.equal(await evaluateLocator(action('Reflow at Full Sentences'), node => node === document.activeElement), true);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    assert.equal(await evaluateLocator(action('Edit or Split...'), node => node === document.activeElement), true);
    await page.keyboard.press('Escape');
    await closed();
    assert.equal(await evaluateLocator(trigger, node => node === document.activeElement), true, 'Escape returns focus to its trigger');
    await openMenu(1);
    assert.equal(await action('Merge with Previous').isDisabled(), true);
    await block(3).getByRole('button', { name: 'Heading actions', exact: true }).click();
    await page.getByRole('menu').waitFor();
    assert.equal(await page.getByRole('menu').count(), 1, 'opening another menu closes the previous one');
    assert.equal(await action('Explain Heading').isVisible(), true);
    assert.equal(await action('Reflow at Full Sentences').count(), 0);
    await page.getByRole('heading', { name: paper.name, exact: true }).click();
    await closed();
    await openMenu(7);
    assert.equal(await action('Merge with Next').isDisabled(), true);
    await page.keyboard.press('Escape');

    // Mac's readingAppearance environment overrides heading sizes and line spacing.
    stage('heading fonts and menu geometry');
    const headingMetrics = () => evaluateLocator(block(2), node => {
      const source = getComputedStyle(node.querySelector('.source-text'));
      const translation = getComputedStyle(node.querySelector('.translation-text'));
      return { source: source.fontSize, sourceLine: source.lineHeight, sourceWeight: source.fontWeight,
        translation: translation.fontSize, translationLine: translation.lineHeight, translationWeight: translation.fontWeight };
    });
    assert.deepEqual(await headingMetrics(), { source: '16px', sourceLine: '24.2px', sourceWeight: '700',
      translation: '16px', translationLine: '24.2px', translationWeight: '400' });
    await page.getByRole('button', { name: 'Reading Appearance', exact: true }).click();
    const fontSlider = page.getByRole('slider', { name: 'Reader font size', exact: true });
    assert.equal(await fontSlider.getAttribute('max'), '24', 'this modern appearance fixture uses the 24px maximum');
    await fontSlider.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    await waitFor(async () => (await headingMetrics()).source === '24px', 'heading reading appearance update');
    assert.deepEqual(await headingMetrics(), { source: '24px', sourceLine: '33.8px', sourceWeight: '700',
      translation: '24px', translationLine: '33.8px', translationWeight: '400' });
    for (const sample of [{ width: 980, height: 720, zoom: 1 }, { width: 1960, height: 1440, zoom: 2 }]) {
      await page.setViewportSize({ width: sample.width, height: sample.height });
      await evaluateMain(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), sample.zoom);
      await block(3).scrollIntoViewIfNeeded();
      const layout = await evaluateLocator(block(3), node => {
        const source = node.querySelector('.source-text').getBoundingClientRect();
        const controls = node.querySelector('.reader-block-actions').getBoundingClientRect();
        return { overlap: source.left < controls.right && source.right > controls.left && source.top < controls.bottom && source.bottom > controls.top,
          overflow: document.documentElement.scrollWidth - innerWidth, sourceRight: source.right, controlsRight: controls.right, viewport: innerWidth };
      });
      assert.equal(layout.overlap, false, JSON.stringify(layout));
      assert.ok(layout.overflow <= 1 && layout.sourceRight <= layout.viewport + 1 && layout.controlsRight <= layout.viewport + 1, JSON.stringify(layout));
      await openMenu(3, true);
      const menu = await evaluateLocator(page.getByRole('menu'), node => {
        const r = node.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight };
      });
      assert.ok(menu.left >= 0 && menu.top >= 0 && menu.right <= menu.width + 1 && menu.bottom <= menu.height + 1, JSON.stringify(menu));
      await bounded(`${phase}: screenshot zoom ${sample.zoom}`, page.screenshot({ path: path.join(workspace, `heading-actions-zoom-${sample.zoom}.png`), timeout: 10000 }), 12000);
      await page.keyboard.press('Escape');
    }
    await evaluateMain(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.setViewportSize({ width: 1500, height: 900 });
    const readingMode = name => page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name, exact: true });
    await readingMode('Original').check();
    assert.equal(await block(3).getByTitle('Translate heading', { exact: true }).count(), 0);
    await readingMode('Translation').check();
    assert.equal(await block(3).getByTitle('Translate heading', { exact: true }).isVisible(), true);
    assert.equal(await block(2).locator('.source-text').isVisible(), false);
    await readingMode('Bilingual').check();

    stage('paragraph explanation without automatic inference');
    const beforeExplain = requests.length;
    await selectText(page, '#block-4 .source-text', 'Unrelated paragraph');
    await block(1).getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await page.locator('.paragraph-explanation').getByText('FULL PARAGRAPH EXPLANATION · BLOCK 1', { exact: true }).waitFor();
    assert.equal(await evaluate(() => window.getSelection()?.toString()), '');
    assert.equal(await page.locator('.inspector blockquote').count(), 0);
    await frames();
    assert.equal(requests.length, beforeExplain, 'choosing explanation must not start generation');
    await page.locator('.paragraph-explanation').getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await page.locator('.paragraph-explanation').getByText('Explanation of the selected full paragraph.', { exact: true }).waitFor();
    assert.equal(requests.length, beforeExplain + 1);
    assert.match(requests.at(-1).prompt, /Target paragraph reports/);

    stage('cancel stale selection lookup');
    mode = 'hold';
    await selectText(page, '#block-4 .source-text', 'Unrelated paragraph');
    await page.locator('.inspector').getByRole('button', { name: 'Translate', exact: true }).click();
    await waitFor(() => heldResponse, 'held selection lookup');
    const selectionRequestCount = requests.length;
    await block(1).getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await page.locator('.paragraph-explanation').getByText('FULL PARAGRAPH EXPLANATION · BLOCK 1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
    heldResponse.end(JSON.stringify({ response: 'Late selection output must not return to the cleared inspector.', done: true }));
    heldResponse = undefined;
    await frames();
    assert.equal(requests.length, selectionRequestCount, 'selecting full-paragraph explanation cancels lookup without starting another request');
    assert.equal(await evaluate(() => window.getSelection()?.toString()), '');
    assert.equal(await page.getByText('Late selection output must not return to the cleared inspector.', { exact: true }).count(), 0);
    mode = 'success';

    stage('completed paragraph retranslation and unfinished range');
    const beforeRetry = requests.length;
    await bodyAction(1, 'Translate This Paragraph');
    await waitFor(() => readPaper().blocks[0].translation.startsWith('新的段落译文'), 'completed paragraph retranslation saved');
    assert.equal(requests.length, beforeRetry + 1);
    const successful = readPaper().blocks[0].translation;
    assert.equal(readPaper().blocks[3].translation, originalBlocks[3].translation);
    assert.equal(readPaper().blocks[1].translation, originalBlocks[1].translation);
    await page.getByRole('button', { name: 'Resume Translation', exact: true }).click();
    await waitFor(() => readPaper().blocks.filter(item => !item.resource).every(item => item.status === 'ok'), 'unfinished batch complete');
    assert.equal(readPaper().blocks[0].translation, successful, 'ordinary range skips the completed target');
    assert.equal(readPaper().blocks[3].translation, originalBlocks[3].translation, 'ordinary range skips unrelated completed output');

    stage('cancel explicit retry and preserve prior output');
    mode = 'hold';
    await bodyAction(1, 'Translate This Paragraph');
    await waitFor(() => heldResponse, 'held explicit retry');
    for (const number of [1, 3, 7]) {
      assert.equal(await block(number).getByRole('button', { name: number === 3 ? 'Heading actions' : 'Paragraph actions', exact: true }).isDisabled(), true);
    }
    assert.equal(await page.getByRole('dialog', { name: /^Repair Paragraph/ }).count(), 0);
    const heldCount = requests.length;
    await block(4).getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await page.locator('.paragraph-explanation').getByText('FULL PARAGRAPH EXPLANATION · BLOCK 4', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).isVisible(), true, 'selecting a paragraph must not cancel translation');
    assert.equal(requests.length, heldCount);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    heldResponse.end(JSON.stringify({ response: 'Late cancelled translation must not overwrite saved text.', done: true }));
    await page.getByText('Translation stopped. Completed blocks are kept.', { exact: true }).waitFor();
    await frames();
    assert.equal(readPaper().blocks[0].translation, successful);
    assert.equal(readPaper().blocks[0].status, 'ok');
    stage('failed retry and recovery');
    mode = 'failure';
    await bodyAction(1, 'Translate This Paragraph');
    await waitFor(() => readPaper().blocks[0].status === 'failed', 'failed explicit retry persisted');
    assert.equal(readPaper().blocks[0].translation, successful, 'failed retry keeps the old saved translation');
    const failedRetry = block(1).getByRole('button', { name: 'Retry this paragraph', exact: true });
    // Persisted failure and React's visible failed state can complete in either order.
    await failedRetry.waitFor({ state: 'visible' });
    assert.equal(await failedRetry.isVisible(), true);
    mode = 'success';
    await failedRetry.click();
    await waitFor(() => readPaper().blocks[0].status === 'ok', 'failed paragraph retry recovered');

    stage('paragraph edit, merge, reflow and undo');
    await bodyAction(1, 'Edit or Split...');
    const editor = page.getByRole('dialog', { name: 'Repair Paragraph 1', exact: true });
    await editor.getByRole('textbox', { name: 'Paragraph source', exact: true }).waitFor();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    const beforeStructure = readPaper().blocks.map(item => ({ id: item.id, text: item.text }));
    await bodyAction(1, 'Merge with Next');
    await waitFor(() => readPaper().blocks.length === beforeStructure.length - 1, 'direct merge from action menu');
    assert.match(readPaper().blocks[0].text, /Results/);
    await undo();
    await waitFor(() => readPaper().blocks.length === beforeStructure.length, 'merge undo');
    await bodyAction(5, 'Reflow at Full Sentences');
    await waitFor(() => readPaper().blocks.length > beforeStructure.length, 'direct sentence reflow from menu');
    await undo();
    await waitFor(() => JSON.stringify(readPaper().blocks.map(item => ({ id: item.id, text: item.text }))) === JSON.stringify(beforeStructure), 'reflow undo source restored');

    stage('MinerU action gates');
    await page.locator('.library-row').filter({ hasText: structured.name }).click();
    await page.getByRole('heading', { name: structured.name, exact: true }).waitFor();
    await openMenu(2);
    for (const name of ['Edit or Split...', 'Merge with Previous', 'Merge with Next', 'Reflow at Full Sentences']) {
      assert.equal(await action(name).isDisabled(), true, `MinerU must disable ${name}`);
    }
    assert.equal(await action('Translate This Paragraph').isEnabled(), true);
    await page.keyboard.press('Escape');
    await openMenu(1, true);
    for (const name of ['Edit or Split', 'Merge with Previous', 'Merge with Next']) assert.equal(await action(name).isDisabled(), true);
    await page.keyboard.press('Escape');
    stage('long Markdown paragraph preserves protected tokens across model requests');
    mode = 'markdown echo';
    const beforeProtected = requests.length;
    await bodyAction(3, 'Translate This Paragraph');
    await waitFor(() => readPaper(structuredId).blocks[2].status !== 'pending', 'long Markdown translation settled');
    const protectedOutput = readPaper(structuredId).blocks[2];
    assert.equal(protectedOutput.status, 'ok', protectedOutput.error);
    const protectedRequests = requests.slice(beforeProtected);
    assert.equal(protectedRequests.length, 2, 'This fixed paragraph must use exactly two bounded model requests');
    for (const request of protectedRequests) {
      assert.ok(request.prompt.includes('\nMarkdown block:\n'));
      const body = request.prompt.split('\nMarkdown block:\n').at(-1);
      assert.ok([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(body)].length <= 500);
    }
    assert.equal(protectedOutput.translation.replace(/\s+/g, ' '), protectedLongSource.replace(/\s+/g, ' '),
      'An unchanged model reply must preserve every formula, link, punctuation mark and Unicode character');
    assert.deepEqual(protectedOutput.translationLanguage, { sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' });
    assert.equal(protectedOutput.sourceMarkdown, protectedLongSource);
    await block(3).locator('.translation-text.done').waitFor();
    mode = 'success';
    await page.locator('.library-row').filter({ hasText: paper.name }).click();
    await page.getByRole('heading', { name: paper.name, exact: true }).waitFor();
    const finalTranslation = readPaper().blocks[0].translation;
    stage('restart persistence');
    await closeElectron('restart');
    await launch();
    assert.equal(readPaper().blocks[0].translation, finalTranslation);
    await block(1).locator('.translation-text.done').getByText(finalTranslation, { exact: true }).waitFor();
    const beforeProtectedRestart = requests.length;
    await page.locator('.library-row').filter({ hasText: structured.name }).click();
    await page.getByRole('heading', { name: structured.name, exact: true }).waitFor();
    await block(3).locator('.translation-text.done').waitFor();
    assert.equal(readPaper(structuredId).blocks[2].translation, protectedOutput.translation);
    assert.deepEqual(readPaper(structuredId).blocks[2].translationLanguage, protectedOutput.translationLanguage);
    assert.equal(requests.length, beforeProtectedRestart, 'Restarting and reopening a saved result must not regenerate it');
    result = { passed: true, workspace, requests: requests.length, checked: [
      'keyboard, Escape, light dismissal and one open menu', 'heading font sizes, source mode, narrow and 200% zoom layout',
      'explicit completed-block retranslation and unfinished range isolation', 'cancellation and failure retain saved output',
      'explanation selection without automatic inference and cancelled stale lookup', 'busy, MinerU, first/last gates',
      'direct edit, merge, reflow and undo', 'long Markdown request chunking, exact protected output and restart persistence'
    ] };
    progress('All assertions passed; beginning cleanup');
  } catch (error) {
    failure = error;
    // Log the primary failure before any browser operation: diagnostics and close may themselves fail.
    console.error(`[reader-actions] FAILED during ${phase}: ${error.stack || error}`);
    progress(`FAILED during ${phase}: ${error.message}`);
    const diagnostics = { phase, error: error.stack || String(error), requests: requests.length, tagRequests };
    if (app) diagnostics.windows = await windowState().catch(cause => ({ error: cause.message }));
    if (page && !page.isClosed()) {
      diagnostics.renderer = await rendererState().catch(cause => ({ error: cause.message }));
      await bounded(`${phase}: failure screenshot`, page.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 4000 }), 5000)
        .catch(cause => { diagnostics.screenshotError = cause.message; });
    }
    console.error(`[reader-actions] Failure diagnostics: ${JSON.stringify(diagnostics)}`);
    fs.writeFileSync(path.join(workspace, 'failure-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  } finally {
    progress(`${phase}: closing fake Ollama connections`);
    ollama.closeAllConnections();
    try { await bounded('fake Ollama close', new Promise(resolve => ollama.close(resolve)), 5000); }
    catch (error) { console.error(error); failure ||= error; }
    try { await closeElectron('final cleanup'); }
    catch (error) { failure ||= error; }
  }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
