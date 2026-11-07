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
    if (await bounded(label, Promise.resolve().then(predicate), Math.max(1, deadline - Date.now()))) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function near(actual, expected, label, tolerance = 1) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'layout-parity-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  let phase = 'fixture setup', app, page, failure, result;
  const progress = message => {
    const line = `${new Date().toISOString()} [layout-parity] ${message}`;
    console.log(line);
    fs.appendFileSync(path.join(workspace, 'progress.log'), `${line}\n`);
  };
  const stage = value => { phase = value; progress(`BEGIN ${phase}`); };
  stage(phase);
  let generationRequests = 0;
  const ollama = http.createServer((request, response) => {
    if (request.url === '/api/generate') generationRequests++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ models: [] }));
  });
  await bounded('fake Ollama listen', new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve)), 5000);
  const settings = { ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, autoCheckUpdates: false,
    onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese',
    fontSize: 16, lineSpacing: 5, readingWidth: 920 };
  const id = crypto.createHash('sha256').update('Long content layout parity').digest('hex');
  const source = Array.from({ length: 20 }, (_, index) =>
    `Line ${index + 1}: The recorded evidence remains available for careful reading, annotation, and independent verification.`).join('\n');
  const translation = Array.from({ length: 20 }, (_, index) =>
    `第 ${index + 1} 行：完整的原文和译文都应当保留，即使检查器中的预览只显示八行。读者仍然可以核对这些研究结论。`).join('\n');
  const explanation = Array.from({ length: 32 }, (_, index) =>
    `Explanation ${index + 1}. This saved explanation describes the evidence and its limitations without requiring a model request.`).join('\n\n');
  const record = (number, text, output, extra = {}) => ({ id: number, text, translation: output, status: 'ok',
    heading: false, bookmark: false, highlights: [], translationHighlights: [], notes: [], ...extra });
  const annotatedPassages = Array.from({ length: 18 }, (_, index) => `Annotation passage ${index + 1}: retained evidence.`);
  const annotatedSource = annotatedPassages.join('\n');
  const blocks = [record(1, 'Layout and evidence', '排版与证据', { heading: true }), record(2, source, translation),
    record(3, annotatedSource, '注释来源不受长文本选择影响。', {
      notes: Array.from({ length: 18 }, (_, index) => ({ id: `layout-note-${index}`, kind: 'source', scope: 'reader',
        text: annotatedPassages[index], offset: annotatedSource.indexOf(annotatedPassages[index]), body: `Saved note ${index + 1}: retain this annotation while reading long content.`,
        createdAt: new Date(2026, 0, index + 1).toISOString() })) })];
  const sourceSummary = '- First evidence item starts with a list so default list margins cannot hide an incorrect label gap.\n- Second evidence item retains its complete source.\n\n' + 'The summary describes a controlled comparison and preserves the limits of the original experiment. '.repeat(20);
  const targetSummary = '- 第一项证据从列表开始，标签和正文之间仍然应保持准确的间距。\n- 第二项证据保留完整来源。\n\n' + '摘要用于核对主要发现及其局限，不能替代原始论文中的证据。'.repeat(24);
  const paper = { id, name: 'A Longitudinal Study of Reliable Scientific Reading Across Languages: Preserving Complete Evidence, Translation Context, and Annotation History in Everyday Research Workflows',
    type: 'text', sourceMode: 'text', extraction: 'Pasted text',
    extractionWarning: 'A long workspace status message explains the document import and preserves enough detail to wrap across multiple lines without separating the status dot from the text. '.repeat(4).trim(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), blocks, taskSettings: settings,
    inspectorOpen: false, explanationLanguage: 'English',
    paragraphExplanations: { '2|English': { id: 2, language: 'English', source, output: explanation } },
    summary: { source: sourceSummary, target: targetSummary, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', claims: [] },
    position: { tab: 'Reader', block: 1, displayMode: 'bilingual', scrollByTab: { Reader: 0 } } };
  const settingsFile = path.join(workspace, 'settings.json');
  const paperFile = path.join(workspace, 'papers', `${id}.json`);
  fs.writeFileSync(settingsFile, JSON.stringify(settings));
  fs.writeFileSync(paperFile, JSON.stringify(paper));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id }));
  const readSettings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const metrics = [];
  const evaluate = (fn, value) => bounded(`${phase}: renderer evaluation`, page.evaluate(fn, value));
  const evaluateMain = (fn, value) => bounded(`${phase}: Electron evaluation`, app.evaluate(fn, value));
  const windowState = () => bounded(`${phase}: window diagnostics`, app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map(window => ({ visible: window.isVisible(), minimized: window.isMinimized(),
      focused: window.isFocused(), bounds: window.getBounds(), destroyed: window.isDestroyed() }))), 3000);
  const rendererState = () => bounded(`${phase}: renderer diagnostics`, page.evaluate(() => ({
    visibilityState: document.visibilityState, focused: document.hasFocus(), width: innerWidth, height: innerHeight,
    activeElement: document.activeElement?.outerHTML.slice(0, 500),
    readingPaperId: document.querySelector('.main-scroll')?.dataset.readingPaperId,
    restoring: document.querySelector('.main-scroll')?.getAttribute('aria-busy'),
    readerScroll: document.querySelector('.main-scroll')?.scrollTop,
    inspectorScroll: document.querySelector('.inspector')?.scrollTop,
    status: document.querySelector('.workspace-status')?.textContent
  })), 3000);
  const screenshot = async name => {
    progress(`${phase}: capturing ${name}`);
    await bounded(`${phase}: screenshot`, page.screenshot({ path: path.join(workspace, name), timeout: 10000 }), 12000);
    progress(`${phase}: captured ${name}`);
  };
  const closeElectron = async () => {
    if (!app) return;
    const ownedApp = app, child = ownedApp.process();
    progress(`${phase}: closing owned Electron pid=${child.pid}`);
    try { await bounded(`${phase}: app.close`, ownedApp.close(), 15000); }
    catch (error) {
      console.error(`[layout-parity] Close failed: ${error.stack || error}`);
      const diagnostics = { phase, windows: await windowState().catch(cause => ({ error: cause.message })),
        renderer: page && !page.isClosed() ? await rendererState().catch(cause => ({ error: cause.message })) : { closed: true } };
      fs.writeFileSync(path.join(workspace, 'close-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
      if (Number.isInteger(child.pid) && child.pid > 0 && child.exitCode === null && child.signalCode === null) {
        try {
          if (process.platform === 'win32') await bounded('owned Electron termination', new Promise((resolve, reject) => {
            execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 },
              cause => cause ? reject(cause) : resolve());
          }), 12000);
          else child.kill('SIGKILL');
        } catch (cause) { console.error(`[layout-parity] Owned cleanup failed: ${cause.stack || cause}`); }
      }
      throw error;
    } finally { app = null; }
  };
  const readingReady = () => waitFor(() => evaluate(expected => {
    const host = document.querySelector('.main-scroll');
    return host?.dataset.readingPaperId === expected && host.getAttribute('aria-busy') === 'false';
  }, id), 'current paper reading restoration completes');
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await bounded(`${phase}: firstWindow`, app.firstWindow(), 30000);
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    await page.locator('#block-2 .source-text').waitFor({ timeout: 20000 });
    await readingReady();
    progress(`Launched pid=${app.process().pid}`);
  };
  const resize = async (width, height, zoom = 1) => {
    await evaluateMain(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), zoom);
    await bounded(`${phase}: viewport resize`, page.setViewportSize({ width, height }));
    await waitFor(() => evaluate(({ width, height, zoom }) => Math.abs(innerWidth - width / zoom) <= 1 &&
      Math.abs(innerHeight - height / zoom) <= 1, { width, height, zoom }), 'requested CSS viewport');
  };
  const readerMetrics = () => evaluate(() => {
    const host = document.querySelector('.main-scroll'), list = document.querySelector('.reader-list');
    const card = document.getElementById('block-2'), last = document.getElementById('block-3');
    const l = list.getBoundingClientRect(), c = card.getBoundingClientRect(), s = getComputedStyle(list);
    return { viewport: innerWidth, hostWidth: host.clientWidth, hostPadding: getComputedStyle(host).padding,
      listWidth: l.width, maxWidth: parseFloat(s.maxWidth), cardWidth: c.width, cardLeft: c.left - l.left,
      cardRight: l.right - c.right, padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft],
      gap: last.getBoundingClientRect().top - c.bottom, lastMargin: getComputedStyle(last).marginBottom,
      font: getComputedStyle(card.querySelector('.source-text')).fontSize,
      line: getComputedStyle(card.querySelector('.source-text')).lineHeight,
      overflow: document.documentElement.scrollWidth - innerWidth, summaryCount: document.querySelectorAll('.reader-summary').length };
  });
  const assertTitleArea = async () => {
    const m = await evaluate(() => {
      const rect = node => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          height: box.height };
      };
      const header = document.querySelector('.workspace > .header'), row = header.querySelector('.title-row');
      const title = row.querySelector('h1'), metadata = row.querySelector('p'), host = document.querySelector('.main-scroll');
      const h = getComputedStyle(header), r = getComputedStyle(row), t = getComputedStyle(title), p = getComputedStyle(metadata);
      return { viewport: { width: innerWidth, height: innerHeight }, workspace: rect(document.querySelector('.workspace')),
        header: rect(header), row: { ...rect(row), minHeight: r.minHeight },
        padding: [h.paddingTop, h.paddingRight, h.paddingBottom, h.paddingLeft],
        title: { ...rect(title), text: title.textContent, tooltip: title.title, font: parseFloat(t.fontSize),
          line: parseFloat(t.lineHeight), clamp: t.webkitLineClamp, whiteSpace: t.whiteSpace, marginBottom: t.marginBottom },
        metadata: { font: parseFloat(p.fontSize), line: parseFloat(p.lineHeight) },
        toolsMargin: getComputedStyle(header.querySelector('.header-tools')).marginTop,
        readerViewport: host.clientHeight, readerScrollHeight: host.scrollHeight, readerOverflow: getComputedStyle(host).overflowY };
    });
    metrics.push({ phase, kind: 'title-area', ...m });
    const short = m.viewport.height <= 600, horizontal = m.viewport.width <= 800 ? '12px' : '22px';
    assert.deepEqual(m.padding, [short ? '12px' : '20px', horizontal, short ? '12px' : '16px', horizontal]);
    assert.equal(m.row.minHeight, short ? '56px' : '64px');
    assert.ok(m.row.height >= (short ? 56 : 64));
    assert.equal(m.title.text, paper.name); assert.equal(m.title.tooltip, paper.name, 'the complete long title remains available');
    assert.equal(m.title.clamp, '2'); assert.equal(m.title.whiteSpace, 'normal');
    assert.equal(m.title.marginBottom, short ? '6px' : '8px'); assert.equal(m.toolsMargin, short ? '12px' : '16px');
    near(m.title.line, m.title.font * 1.25, 'title line height');
    near(m.metadata.line, m.metadata.font * 1.5, 'metadata line height');
    assert.ok(m.title.height >= m.title.line - 1 && m.title.height <= m.title.line * 2 + 1, 'long title occupies at most two full lines');
    for (const box of [m.header, m.row, m.title]) assert.ok(box.left >= m.workspace.left - 1 && box.right <= m.workspace.right + 1 &&
      box.top >= m.workspace.top - 1 && box.bottom <= m.workspace.bottom + 1 && box.bottom <= m.viewport.height + 1,
    `the title area stays inside the workspace: ${JSON.stringify(m)}`);
    assert.ok(m.readerViewport >= 24 && m.readerScrollHeight > m.readerViewport,
      'a usable scrolling document viewport remains below the title area, including short and zoomed windows');
    assert.ok(['auto', 'scroll'].includes(m.readerOverflow), 'the document viewport retains its scrollbar');
  };
  const assertReader = async expected => {
    await assertTitleArea();
    const m = await readerMetrics(); metrics.push({ phase, kind: 'reader', ...m });
    near(m.maxWidth, expected, 'configured outer reading width');
    near(m.listWidth, Math.min(expected, m.hostWidth), 'reading width shrinks to available viewport');
    near(m.cardWidth, m.listWidth - 44, 'card width includes both 22px reader insets');
    near(m.cardLeft, 22, 'left reader inset'); near(m.cardRight, 22, 'right reader inset');
    assert.deepEqual(m.padding, ['22px', '22px', '22px', '22px']);
    assert.equal(m.hostPadding, '0px', 'main scroll must not add another layer of reader padding');
    near(m.gap, 16, 'paragraph spacing'); assert.equal(m.lastMargin, '0px');
    assert.equal(m.summaryCount, 0, 'Reader starts with status and paragraphs, as on macOS');
    assert.ok(m.overflow <= 1, JSON.stringify(m));
    return m;
  };
  const assertStatus = async () => {
    const m = await evaluate(() => {
      const node = document.querySelector('.workspace-status'), text = node.querySelector('span');
      const style = getComputedStyle(node), dot = getComputedStyle(node, '::before'), box = node.getBoundingClientRect();
      return { padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], radius: style.borderRadius,
        gap: style.gap, dot: [dot.width, dot.height], textLeft: text.getBoundingClientRect().left - box.left,
        border: parseFloat(style.borderLeftWidth), textHeight: text.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(text).lineHeight) || parseFloat(getComputedStyle(text).fontSize) * 1.2,
        text: text.textContent };
    });
    metrics.push({ phase, kind: 'status', ...m });
    assert.deepEqual(m.padding, ['14px', '14px', '14px', '14px']); assert.equal(m.radius, '14px');
    assert.equal(m.gap, '10px'); assert.deepEqual(m.dot, ['7px', '7px']);
    near(m.textLeft, m.border + 14 + 7 + 10, 'dot and wrapped text remain adjacent');
    assert.equal(m.text, paper.extractionWarning); assert.ok(m.textHeight > m.lineHeight * 2, 'long status really wraps');
  };
  const assertSummary = async fullWidth => {
    await assertTitleArea();
    const m = await evaluate(() => {
      const outer = document.querySelector('.overview-layout'), view = document.querySelector('.summary-view');
      const panels = document.querySelector('.summary-panels'), children = [...panels.children];
      const boxes = children.map(node => node.getBoundingClientRect());
      const horizontal = Math.abs(boxes[0].top - boxes[1].top) < 1;
      return { outer: outer.getBoundingClientRect().width, outerPadding: getComputedStyle(outer).padding,
        hostPadding: getComputedStyle(document.querySelector('.main-scroll')).padding,
        view: view.getBoundingClientRect().width, viewPadding: getComputedStyle(view).padding,
        panels: panels.getBoundingClientRect().width, gap: getComputedStyle(panels).gap, horizontal,
        actualGap: horizontal ? boxes[1].left - boxes[0].right : boxes[1].top - boxes[0].bottom,
        overflow: document.documentElement.scrollWidth - innerWidth,
        cards: children.map(node => {
          const style = getComputedStyle(node), label = node.querySelector('small'), body = node.querySelector('[data-markdown-host]');
          return { width: node.getBoundingClientRect().width, padding: style.padding, radius: style.borderRadius,
            border: style.borderTopWidth, gap: style.gap, labelGap: body.getBoundingClientRect().top - label.getBoundingClientRect().bottom,
            firstContentGap: body.firstElementChild.getBoundingClientRect().top - label.getBoundingClientRect().bottom,
            bodyWidth: body.getBoundingClientRect().width, startsWithList: body.firstElementChild.tagName === 'UL', text: body.textContent };
        }) };
    });
    metrics.push({ phase, kind: 'summary', ...m });
    assert.equal(m.hostPadding, '0px', 'Summary uses its own 22px padding at every breakpoint');
    assert.equal(m.outerPadding, '22px'); assert.equal(m.viewPadding, '22px');
    assert.equal(m.gap, '18px'); near(m.actualGap, 18, 'actual summary panel gap');
    for (const card of m.cards) {
      assert.equal(card.padding, '14px'); assert.equal(card.radius, '10px'); assert.equal(card.border, '0px');
      assert.equal(card.gap, '9px'); near(card.labelGap, 9, 'summary label to Markdown host gap');
      near(card.firstContentGap, 9, 'summary label to first list gap'); assert.equal(card.startsWithList, true);
      near(card.bodyWidth, card.width - 28, 'summary body has exactly 14px insets'); assert.ok(card.text.length > 500);
    }
    if (fullWidth) {
      near(m.outer, 1020, 'Overview outer width'); near(m.view, 976, 'summary outer card');
      near(m.panels, 932, 'summary panels group'); assert.equal(m.horizontal, true);
      m.cards.forEach(card => { near(card.width, 457, 'summary panel width'); near(card.bodyWidth, 429, 'summary prose width'); });
    }
    assert.ok(m.overflow <= 1, JSON.stringify(m));
  };
  const selectPassage = async kind => {
    const quote = kind === 'source' ? source : translation;
    await bounded(`${phase}: select complete passage`, page.locator(`#block-2 .${kind}-text`).evaluate((node, quote) => {
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      if (selection.toString() !== quote) throw new Error('Long selection fixture no longer matches the source DOM');
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, quote));
    if (await page.locator('.selection-toolbar').count()) await page.getByRole('button', { name: 'Notes & More', exact: true }).click();
    await page.locator('.inspector-quote-text').waitFor();
    await waitFor(() => evaluate(quote => document.querySelector('.inspector-quote-text')?.textContent === quote, quote), 'complete quote in inspector');
    return quote;
  };
  const assertInspector = async quote => {
    const m = await evaluate(() => {
      const inspector = document.querySelector('.inspector'), outer = inspector.getBoundingClientRect();
      const quote = inspector.querySelector('.inspector-selection-quote'), text = quote.querySelector('.inspector-quote-text');
      const q = getComputedStyle(quote), t = getComputedStyle(text);
      const pane = selector => {
        const node = inspector.querySelector(selector), s = getComputedStyle(node);
        return { selector, overflow: s.overflowY, height: node.clientHeight, scrollHeight: node.scrollHeight,
          maxHeight: s.maxHeight, rectHeight: node.getBoundingClientRect().height };
      };
      return { width: innerWidth, height: innerHeight, left: outer.left, right: outer.right, top: outer.top, bottom: outer.bottom,
        outer: { overflow: getComputedStyle(inspector).overflowY, client: inspector.clientHeight, scroll: inspector.scrollHeight },
        quote: { text: text.textContent, font: q.fontSize, padding: q.padding, radius: q.borderRadius, side: quote.dataset.side,
          clamp: t.webkitLineClamp, whiteSpace: t.whiteSpace, lineHeight: parseFloat(t.lineHeight),
          height: text.getBoundingClientRect().height, scrollHeight: text.scrollHeight },
        panes: ['.inspector-body', '.inspector-primary', '.inspector-scroll', '.inspector-supporting', '.paragraph-explanation', '.saved-annotations'].map(pane),
        notes: inspector.querySelectorAll('.saved-annotations .annotation-row').length,
        explanation: inspector.querySelector('.paragraph-explanation p')?.textContent,
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    metrics.push({ phase, kind: 'inspector', ...m });
    assert.equal(m.quote.text, quote, 'quote remains complete beyond 350 characters');
    assert.equal(m.quote.font, '15px'); assert.equal(m.quote.padding, '12px'); assert.equal(m.quote.radius, '9px');
    assert.equal(m.quote.clamp, '8'); assert.equal(m.quote.whiteSpace, 'pre-wrap');
    near(m.quote.height, m.quote.lineHeight * 8, 'quote preview uses eight full text lines');
    assert.ok(m.quote.scrollHeight > m.quote.height, 'long quote is visually clamped, not text-truncated');
    assert.equal(m.notes, 18); assert.equal(m.explanation, explanation);
    assert.ok(m.overflow <= 1 && m.left >= -1 && m.right <= m.width + 1 && m.bottom <= m.height + 1, JSON.stringify(m));
    for (const pane of m.panes.filter(item => ['.paragraph-explanation', '.saved-annotations'].includes(item.selector))) {
      assert.equal(pane.maxHeight, 'none');
      assert.ok(!['auto', 'scroll'].includes(pane.overflow), `${pane.selector} must not introduce its own scrollbar`);
      assert.ok(pane.scrollHeight <= pane.height + 1, `${pane.selector} must expose all content to its outer scroll container`);
    }
    assert.ok(m.panes.find(item => item.selector === '.paragraph-explanation').rectHeight > 190);
    assert.ok(m.panes.find(item => item.selector === '.saved-annotations').rectHeight > m.height * .38);
    if (m.width >= 1400) {
      assert.ok(['auto', 'scroll'].includes(m.outer.overflow) && m.outer.scroll > m.outer.client);
      for (const pane of m.panes) assert.ok(!['auto', 'scroll'].includes(pane.overflow), `${pane.selector} adds a nested sidebar scrollbar`);
    } else {
      for (const name of ['.inspector-primary', '.inspector-supporting']) {
        const pane = m.panes.find(item => item.selector === name);
        assert.ok(['auto', 'scroll'].includes(pane.overflow) && pane.scrollHeight > pane.height, `${name} is independently scrollable in drawer mode`);
      }
    }
    return m;
  };
  const scrollInspectorToEnd = async () => {
    const m = await evaluate(() => {
      const host = document.querySelector(innerWidth >= 1400 ? '.inspector-sidebar' : '.inspector-supporting');
      host.scrollTop = host.scrollHeight;
      const row = host.querySelector('.saved-annotations .annotation-row:last-child'), box = row.getBoundingClientRect(), bounds = host.getBoundingClientRect();
      return { scroll: host.scrollTop, bottom: box.bottom, top: box.top, hostTop: bounds.top, hostBottom: bounds.top + host.clientHeight };
    });
    assert.ok(m.scroll > 0 && m.top >= m.hostTop - 1 && m.bottom <= m.hostBottom + 1, 'the final saved annotation is reachable through its outer scroller');
  };
  try {
    stage('default Reader geometry and wrapped status');
    await launch(); await resize(1320, 820); await assertReader(920); await assertStatus();
    await screenshot('reader-default.png');
    stage('wide Reader and appearance width limits');
    await resize(1600, 1000);
    await page.getByRole('button', { name: 'Focus Reading', exact: true }).click();
    const appearance = () => page.getByRole('dialog', { name: 'Reading Appearance', exact: true });
    await page.getByRole('button', { name: 'Reading Appearance', exact: true }).click();
    await appearance().getByRole('slider', { name: 'Reading width', exact: true }).press('End');
    await page.keyboard.press('Escape');
    await waitFor(async () => (await readerMetrics()).maxWidth === 1200, 'maximum reading width applies');
    await assertReader(1200);
    await page.getByRole('button', { name: 'Reading Appearance', exact: true }).click();
    await appearance().getByRole('slider', { name: 'Reading width', exact: true }).press('Home');
    await page.keyboard.press('Escape'); await assertReader(640);
    await page.getByRole('button', { name: 'Reading Appearance', exact: true }).click();
    await appearance().getByRole('button', { name: 'Reset Appearance', exact: true }).click();
    await page.keyboard.press('Escape'); await assertReader(920);
    stage('wide Summary outer card, first-list gaps and long content');
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.locator('.summary-panels').waitFor(); await assertSummary(true); await screenshot('summary-wide.png');
    stage('800px Summary padding in Focus and no-inspector modes');
    await resize(1600, 1240, 2);
    await assertSummary(false); await screenshot('summary-800-focus.png');
    await page.getByRole('button', { name: 'Exit Focus Reading', exact: true }).click();
    assert.equal(await page.locator('.inspector').isVisible(), false, 'the mounted inspector is hidden in no-inspector mode');
    assert.equal(await page.locator('.app.no-inspector').count(), 1);
    await assertSummary(false); await screenshot('summary-800-no-inspector.png');
    await resize(1600, 1000);
    await page.getByRole('button', { name: 'Reader', exact: true }).click(); await readingReady();
    stage('wide Inspector source, translation and single outer scroll');
    await page.locator('#block-2').getByRole('button', { name: 'Explain full paragraph', exact: true }).click();
    await page.locator('.paragraph-explanation p').waitFor();
    await selectPassage('translation'); await assertInspector(translation);
    await selectPassage('source'); await assertInspector(source);
    await evaluate(() => { document.querySelector('.inspector').scrollTop = 0; }); await screenshot('inspector-wide.png');
    await scrollInspectorToEnd(); await screenshot('inspector-wide-end.png');
    for (const sample of [{ width: 1320, height: 820, zoom: 1, label: 'default' },
      { width: 980, height: 620, zoom: 1, label: 'compact' }, { width: 1960, height: 1240, zoom: 2, label: 'zoom-200' },
      { width: 1960, height: 1000, zoom: 2, label: 'zoom-200-short' }]) {
      stage(`${sample.label} Reader and Inspector long content`);
      await resize(sample.width, sample.height, sample.zoom);
      await assertReader(920); await assertInspector(source); await scrollInspectorToEnd();
      await screenshot(`inspector-${sample.label}.png`);
      await page.getByRole('button', { name: 'Close inspector drawer', exact: true }).click();
      await page.getByRole('button', { name: 'Overview', exact: true }).click();
      await assertSummary(false); await screenshot(`summary-${sample.label}.png`);
      await page.getByRole('button', { name: 'Reader', exact: true }).click(); await readingReady();
      await selectPassage('source');
    }
    stage('legacy 560px appearance survives reopening without resetting output');
    await resize(1320, 820);
    await page.getByRole('button', { name: 'Close inspector drawer', exact: true }).click();
    await waitFor(() => readSettings().readingWidth === 920, 'appearance reset persisted');
    await closeElectron();
    const legacy = { ...readSettings(), fontSize: 25, lineHeight: 1.9, readingWidth: 560 };
    delete legacy.lineSpacing; delete legacy.legacyAppearanceRanges;
    fs.writeFileSync(settingsFile, JSON.stringify(legacy));
    await launch(); await resize(1320, 820);
    const legacyMetrics = await assertReader(560);
    assert.equal(legacyMetrics.font, '25px'); assert.equal(legacyMetrics.line, '47.5px');
    await page.getByRole('button', { name: 'Reading Appearance', exact: true }).click();
    assert.equal(await appearance().getByRole('slider', { name: 'Reading width', exact: true }).inputValue(), '560');
    await appearance().getByRole('slider', { name: 'Reading width', exact: true }).press('ArrowRight');
    await page.keyboard.press('Escape'); await assertReader(561);
    await page.getByRole('button', { name: 'Reading Appearance', exact: true }).click();
    await appearance().getByRole('button', { name: 'Reset Appearance', exact: true }).click();
    await page.keyboard.press('Escape'); await assertReader(920);
    await waitFor(() => readSettings().readingWidth === 920 && readSettings().fontSize === 16, 'modern defaults persisted');
    const saved = JSON.parse(fs.readFileSync(paperFile, 'utf8'));
    assert.equal(saved.blocks[1].text, source); assert.equal(saved.blocks[1].translation, translation);
    assert.equal(saved.blocks[2].notes.length, 18); assert.equal(saved.summary.source, sourceSummary);
    assert.equal(generationRequests, 0, 'layout, selection and appearance do not send any model requests');
    assert.ok(metrics.filter(item => item.kind === 'title-area').some(item =>
      Math.abs(item.title.height - item.title.line * 2) <= 1), 'the long fixture exercises a two-line paper title');
    result = { passed: true, workspace, metrics, checked: ['Reader width includes 22px padding', 'status geometry and wrapped text',
      'spacious two-line paper title, complete tooltip and usable reading viewport at 200% zoom and short heights',
      'Summary 1020/976/932/457/429 width chain', 'Summary 14px padding, 18px gap and 9px first-list gap',
      'complete multiline source and translated quotes clamped to eight lines', 'single outer sidebar scroll',
      'drawer independent columns with uncapped explanation and saved annotations', '980x620 and 200% zoom',
      '800px Focus and no-inspector Summary preserve zero host padding',
      'appearance min/max/reset and persisted legacy width', 'cached content and annotations preserved without AI'] };
    progress('All assertions passed; beginning cleanup');
  } catch (error) {
    failure = error;
    console.error(`[layout-parity] FAILED during ${phase}: ${error.stack || error}`);
    progress(`FAILED during ${phase}: ${error.message}`);
    const diagnostics = { phase, error: error.stack || String(error), metrics, generationRequests };
    if (app) diagnostics.windows = await windowState().catch(cause => ({ error: cause.message }));
    if (page && !page.isClosed()) {
      diagnostics.renderer = await rendererState().catch(cause => ({ error: cause.message }));
      await bounded('failure screenshot', page.screenshot({ path: path.join(workspace, 'failure.png'), timeout: 4000 }), 5000)
        .catch(cause => { diagnostics.screenshotError = cause.message; });
    }
    fs.writeFileSync(path.join(workspace, 'failure-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  } finally {
    ollama.closeAllConnections();
    try { await bounded('fake Ollama close', new Promise(resolve => ollama.close(resolve)), 5000); }
    catch (error) { console.error(error); failure ||= error; }
    try { await closeElectron(); } catch (error) { failure ||= error; }
  }
  if (failure) throw failure;
  fs.writeFileSync(path.join(workspace, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, workspace, checked: result.checked }));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
