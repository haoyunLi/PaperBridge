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
    catch { /* Saves and scroll restoration may still be settling. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'outline-'));
  let phase = 'fixture setup';
  const progress = message => {
    const line = `${new Date().toISOString()} [outline] ${message}`;
    console.log(line);
    fs.appendFileSync(path.join(workspace, 'progress.log'), `${line}\n`);
  };
  const stage = value => { phase = value; progress(`BEGIN ${phase}`); };
  stage('fixture setup');
  fs.mkdirSync(path.join(workspace, 'papers'));
  const id = crypto.createHash('sha256').update('Long outline fixture').digest('hex');
  const plainId = crypto.createHash('sha256').update('No heading outline fixture').digest('hex');
  let generationRequests = 0;
  const ollama = http.createServer((request, response) => {
    if (request.url === '/api/generate') generationRequests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [] }));
  });
  await bounded('fake Ollama listen', new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve)), 5000);
  const settings = { ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const record = (number, text, heading = false) => ({ id: number, text, heading, page: 1, status: 'ok',
    translation: heading ? `章节 ${number}` : `段落 ${number} 的已存译文。这些内容用于检验阅读导航与原文显示。`.repeat(3),
    bookmark: false, highlights: [], translationHighlights: [], notes: [] });
  const blocks = Array.from({ length: 65 }, (_, index) => {
    const headingId = index * 3 + 1;
    const title = ['Abstract', 'Methods', 'Results'][index] ||
      `Section ${index + 1}: A Detailed Heading About Reproducible Evidence And Careful Interpretation`;
    const repeat = index === 64 ? 32 : 3;
    return [record(headingId, title, true),
      record(headingId + 1, `Section ${index + 1} opening passage. ` + 'This passage documents the evidence and explains why the reported observation can be checked against the original source. '.repeat(repeat)),
      record(headingId + 2, `Section ${index + 1} later passage. ` + 'Further details distinguish this location from the heading and allow exact scroll restoration during reading. '.repeat(repeat))];
  }).flat();
  const paper = { id, name: 'Sixty-five section outline', type: 'text', sourceMode: 'text', extraction: 'Pasted text',
    blocks, taskSettings: settings, inspectorOpen: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    position: { tab: 'Reader', block: 1, displayMode: 'bilingual', scrollByTab: { Reader: 0 } } };
  const plainBlocks = [1, 2, 3].map(number => record(number,
    `Unheaded passage ${number}. ` + 'A long source paragraph provides a stable location without inventing a section title. '.repeat(18)));
  const plain = { ...paper, id: plainId, name: 'Paper without headings', blocks: plainBlocks };
  const paperFile = paperId => path.join(workspace, 'papers', `${paperId}.json`);
  const readPaper = (paperId = id) => JSON.parse(fs.readFileSync(paperFile(paperId), 'utf8'));
  fs.writeFileSync(paperFile(id), JSON.stringify(paper));
  fs.writeFileSync(paperFile(plainId), JSON.stringify(plain));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));

  let app, page, failure, result;
  const evaluate = (fn, value) => bounded(`${phase}: renderer evaluation`, page.evaluate(fn, value));
  const evaluateMain = (fn, value) => bounded(`${phase}: Electron evaluation`, app.evaluate(fn, value));
  const evaluateLocator = (locator, fn) => bounded(`${phase}: element evaluation`, locator.evaluate(fn));
  const viewport = size => bounded(`${phase}: resize viewport`, page.setViewportSize(size));
  const windowState = () => bounded(`${phase}: window diagnostics`, app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), minimized: window.isMinimized(),
      focused: window.isFocused(), bounds: window.getBounds(), destroyed: window.isDestroyed() }))), 3000);
  const rendererState = () => bounded(`${phase}: renderer diagnostics`, page.evaluate(() => ({
    visibilityState: document.visibilityState, focused: document.hasFocus(), width: innerWidth, height: innerHeight,
    activeElement: document.activeElement?.outerHTML.slice(0, 500),
    status: document.querySelector('.save-status')?.textContent,
    readerScroll: document.querySelector('.main-scroll')?.scrollTop,
    sidebarScroll: document.querySelector('.sidebar-scroll')?.scrollTop,
    currentParagraph: document.querySelector('.document-outline [aria-current="location"]')?.dataset.paragraphId,
    outlineRows: document.querySelectorAll('.document-outline .outline-row').length
  })), 3000);
  const screenshot = async name => {
    progress(`${phase}: capturing ${name}`);
    await bounded(`${phase}: screenshot ${name}`, page.screenshot({ path: path.join(workspace, name), timeout: 10000 }), 12000);
    progress(`${phase}: captured ${name}`);
  };
  const closeElectron = async label => {
    if (!app) return;
    const ownedApp = app;
    const child = ownedApp.process();
    progress(`${label}: closing Electron pid=${child.pid}`);
    try {
      await bounded(`${label}: app.close`, ownedApp.close(), 15000);
      progress(`${label}: Electron closed`);
    } catch (error) {
      console.error(`[outline] ${phase}: ${error.stack || error}`);
      const diagnostics = { phase, windows: await windowState().catch(cause => ({ error: cause.message })),
        renderer: page && !page.isClosed() ? await rendererState().catch(cause => ({ error: cause.message })) : { closed: true } };
      console.error(`[outline] Close diagnostics: ${JSON.stringify(diagnostics)}`);
      fs.writeFileSync(path.join(workspace, 'close-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
      if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        progress(`${label}: terminating only owned Electron process tree pid=${child.pid}`);
        try {
          if (process.platform === 'win32') {
            await bounded(`${label}: owned Electron process termination`, new Promise((resolve, reject) => {
              execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 },
                cause => cause ? reject(cause) : resolve());
            }), 12000);
          } else child.kill('SIGKILL');
        } catch (cleanupError) { console.error(`[outline] Owned process cleanup failed: ${cleanupError.stack || cleanupError}`); }
      }
      throw error; // Cleanup timeout must fail the suite, even if all assertions passed.
    } finally { app = null; }
  };
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded(`${phase}: firstWindow`, app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    await viewport({ width: 1500, height: 900 });
    await page.locator('.document-outline').waitFor({ timeout: 20000 });
    progress(`${phase}: launched pid=${app.process().pid} window=${JSON.stringify(await windowState())}`);
  };
  const outline = () => page.locator('.document-outline');
  const row = number => outline().locator(`.outline-row[data-paragraph-id="${number}"]`);
  const current = () => outline().locator('.outline-row[aria-current="location"]');
  const mode = name => page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name, exact: true });
  const back = () => page.getByRole('button', { name: 'Back to previous reading location', exact: true });
  const forward = () => page.getByRole('button', { name: 'Forward in reading history', exact: true });
  const scroll = () => evaluateLocator(page.locator('.main-scroll'), node => node.scrollTop);
  const scrollToBlock = async (number, paperId = id) => {
    await evaluate(number => {
      const host = document.querySelector('.main-scroll');
      const block = document.getElementById(`block-${number}`);
      host.scrollTop += block.getBoundingClientRect().top - host.getBoundingClientRect().top + 20;
      host.dispatchEvent(new Event('scroll'));
    }, number);
    await waitFor(async () => readPaper(paperId).position.block === number &&
      Math.abs((readPaper(paperId).position.scrollByTab?.Reader || 0) - await scroll()) < 2, 'manual Reader position saved');
  };
  const headingAtTop = async number => {
    await waitFor(() => evaluate(number => {
      const host = document.querySelector('.main-scroll');
      const block = document.getElementById(`block-${number}`);
      const delta = block.getBoundingClientRect().top - host.getBoundingClientRect().top;
      return delta >= -2 && delta < 25;
    }, number), `Reader jump to heading ${number}`);
  };
  try {
    stage('launch, complete outline and document disclosure');
    await launch();
    assert.equal(await outline().locator('.outline-row').count(), 65, 'the outline must retain sections beyond the previous 60-item limit');
    for (const number of [1, 4, 7, 181, 193]) {
      assert.equal((await row(number).locator('small').textContent()).trim(), String(number), 'outline numbers identify paragraphs, not shared page metadata');
    }
    const longTitle = blocks.find(block => block.id === 181).text;
    assert.equal(await row(181).locator('span').textContent(), longTitle, 'visual wrapping must retain the full heading text');
    const documentDetails = page.locator('.document-details');
    const openPdf = documentDetails.getByRole('button', { name: 'Open PDF', exact: true, includeHidden: true });
    const pasteText = documentDetails.getByRole('button', { name: 'Paste Text', exact: true, includeHidden: true });
    assert.equal(await documentDetails.getAttribute('open'), null, 'Document & Import begins collapsed');
    assert.equal(await openPdf.isVisible(), false, 'loaded papers keep import controls collapsed');
    assert.equal(await pasteText.isVisible(), false);
    await documentDetails.locator('summary').click();
    await openPdf.waitFor({ state: 'visible' });
    assert.equal(await pasteText.isVisible(), true);
    await documentDetails.locator('summary').click();
    await openPdf.waitFor({ state: 'hidden' });
    stage('initial 980px outline geometry and screenshot');
    await viewport({ width: 980, height: 620 });
    await evaluateLocator(page.locator('.sidebar-scroll'), node => { node.scrollTop = 0; });
    const initialOutline = await evaluateLocator(page.locator('.sidebar-scroll'), host => {
      const clip = host.getBoundingClientRect();
      const title = host.querySelector('.document-outline .side-label').getBoundingClientRect();
      const rows = [...host.querySelectorAll('.document-outline .outline-row')].filter(row => {
        const r = row.getBoundingClientRect();
        return r.top >= clip.top && r.bottom <= clip.bottom;
      });
      return { titleTop: title.top, clipTop: clip.top, clipBottom: clip.bottom,
        fullyVisibleParagraphs: rows.map(row => Number(row.dataset.paragraphId)) };
    });
    await screenshot('outline-initial-980.png');
    stage('same-page heading navigation');
    await viewport({ width: 1500, height: 900 });
    await row(4).click();
    await headingAtTop(4);
    assert.equal(await current().getAttribute('data-paragraph-id'), '4');
    await row(7).click();
    await headingAtTop(7);
    assert.equal(await current().getAttribute('data-paragraph-id'), '7', 'same-page headings keep separate selected markers');

    // Every outline entry remains reachable when the sidebar is constrained.
    const geometry = [];
    for (const sample of [{ width: 980, height: 620, zoom: 1 }, { width: 1960, height: 1240, zoom: 2 }]) {
      stage(`last outline entry geometry, navigation and screenshot at zoom ${sample.zoom}`);
      await viewport({ width: sample.width, height: sample.height });
      await evaluateMain(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoom), sample.zoom);
      await row(193).scrollIntoViewIfNeeded();
      const bounds = await evaluateLocator(row(193), node => {
        const row = node.getBoundingClientRect(), sidebar = node.closest('.sidebar').getBoundingClientRect();
        let host = node.parentElement;
        while (host && !/(auto|scroll)/.test(getComputedStyle(host).overflowY)) host = host.parentElement;
        const clip = host?.getBoundingClientRect() || sidebar;
        return { left: row.left, right: row.right, top: row.top, bottom: row.bottom,
          sidebarLeft: sidebar.left, sidebarRight: sidebar.right, clipTop: clip.top, clipBottom: clip.bottom,
          overflow: document.documentElement.scrollWidth - innerWidth, zoom: devicePixelRatio };
      });
      assert.ok(bounds.left >= bounds.sidebarLeft && bounds.right <= bounds.sidebarRight + 1, JSON.stringify(bounds));
      assert.ok(bounds.top >= bounds.clipTop - 1 && bounds.bottom <= bounds.clipBottom + 1 && bounds.overflow <= 1, JSON.stringify(bounds));
      geometry.push(bounds);
      await row(193).click();
      await headingAtTop(193);
      assert.equal(await current().getAttribute('data-paragraph-id'), '193');
      await screenshot(`outline-zoom-${sample.zoom}.png`);
    }
    await evaluateMain(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await viewport({ width: 1500, height: 900 });

    // Outline navigation participates in the same exact-location Back/Forward history.
    stage('exact-location Back and Forward history');
    await scrollToBlock(11);
    await page.locator('#block-11 .source-text').click();
    assert.equal(await current().count(), 0, 'selecting a body paragraph must not mark a different heading as the exact selected paragraph');
    const origin = await scroll();
    await row(193).click();
    await headingAtTop(193);
    await back().click();
    await waitFor(async () => readPaper().position.block === 11 && Math.abs(await scroll() - origin) < 3, 'Back restores the pre-outline reading position');
    await forward().click();
    await headingAtTop(193);
    assert.equal(await current().getAttribute('data-paragraph-id'), '193');

    // Overview links quote source passages, so translation-only mode must reveal source.
    stage('Overview source revelation and history');
    await mode('Translation').check();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    const mapLink = page.locator('.reading-map').getByRole('button', { name: 'Read paragraph 5 →', exact: true });
    await mapLink.waitFor();
    await mapLink.click();
    await page.locator('.reader-list').waitFor();
    assert.equal(await mode('Bilingual').isChecked(), true);
    await page.locator('#block-5 .source-text').getByText(blocks[4].text, { exact: true }).waitFor();
    await waitFor(() => readPaper().position.block === 5, 'reading map source target saved');
    await back().click();
    await mapLink.waitFor();
    assert.equal(readPaper().position.displayMode, 'translation', 'Back restores the original Overview display mode');
    await forward().click();
    await waitFor(() => page.locator('.reader-list').count().then(Boolean), 'Forward restores the Reader map destination');
    assert.equal(await mode('Bilingual').isChecked(), true);
    assert.equal(await page.locator('#block-5 .source-text').isVisible(), true);

    stage('Beginning fallback and independent paper history');
    await page.locator('.library-row').filter({ hasText: plain.name }).click();
    await page.getByRole('heading', { name: plain.name, exact: true }).waitFor();
    assert.equal(await outline().locator('.outline-row').count(), 1);
    assert.match(await row(1).textContent(), /Beginning/);
    assert.equal(await back().isDisabled(), true, 'another paper starts with its own empty session history');
    assert.equal(await forward().isDisabled(), true);
    await scrollToBlock(2, plainId);
    const plainOrigin = await scroll();
    await row(1).click();
    await headingAtTop(1);
    assert.equal(await current().getAttribute('data-paragraph-id'), '1');
    await back().click();
    await waitFor(async () => readPaper(plainId).position.block === 2 && Math.abs(await scroll() - plainOrigin) < 3, 'Beginning participates in reading history');
    await forward().click();
    await headingAtTop(1);
    stage('restore previous paper outline and position');
    await page.locator('.library-row').filter({ hasText: paper.name }).click();
    await page.getByRole('heading', { name: paper.name, exact: true }).waitFor();
    assert.equal(await outline().locator('.outline-row').count(), 65);
    assert.equal(await back().isDisabled(), true);
    assert.equal(await mode('Bilingual').isChecked(), true);
    await waitFor(() => readPaper().position.block === 5, 'returning paper restores its own saved Reader destination');
    await page.locator('.library-row').filter({ hasText: plain.name }).click();
    await page.getByRole('heading', { name: plain.name, exact: true }).waitFor();
    await row(1).click();
    await headingAtTop(1);
    stage('restart persistence');
    await closeElectron('restart');
    await launch();
    await page.getByRole('heading', { name: plain.name, exact: true }).waitFor();
    assert.equal(await outline().locator('.outline-row').count(), 1);
    assert.match(await row(1).textContent(), /Beginning/);
    assert.equal(generationRequests, 0, 'outline and source-map navigation do not invoke AI');
    result = { passed: true, workspace, initialOutline, geometry, checked: ['65 sections retained', 'same-page paragraph identifiers',
      'full heading text', 'exact selected-heading marker', 'Beginning fallback', '980x620 and 200% zoom',
      'outline Back/Forward positions', 'Overview links reveal source and restore mode on Back',
      'paper-specific outline, position and history', 'restart without AI'] };
    progress('All assertions passed; beginning cleanup');
  } catch (error) {
    failure = error;
    // Report before screenshot/close so a second failure cannot conceal the original error.
    console.error(`[outline] FAILED during ${phase}: ${error.stack || error}`);
    progress(`FAILED during ${phase}: ${error.message}`);
    const diagnostics = { phase, error: error.stack || String(error), generationRequests };
    if (app) diagnostics.windows = await windowState().catch(cause => ({ error: cause.message }));
    if (page && !page.isClosed()) {
      diagnostics.renderer = await rendererState().catch(cause => ({ error: cause.message }));
      await bounded(`${phase}: failure screenshot`, page.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 4000 }), 5000)
        .catch(cause => { diagnostics.screenshotError = cause.message; });
    }
    console.error(`[outline] Failure diagnostics: ${JSON.stringify(diagnostics)}`);
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
