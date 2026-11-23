const { revealSidebarSource, openPasteText, loadPastedText, openWorkspaceView } = require('./sidebar-controls.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'summary-e2e-'));
  const summaryModel = 'summary-test:latest';
  const translationModel = 'translation-test:latest';
  const opening = 'The team calibrated each sensor in the Montre\u0301al laboratory before collecting baseline measurements and repeating the procedure at a second site.';
  const tail = 'At the end of the Montre\u0301al study the test failed under low visibility conditions.';
  const headingQuote = 'Measurement Uncertainty Across Independent Replicates';
  const numberedHeading = '2. ' + headingQuote;
  const unvalidated = 'The appendix reported a separate measurement without a confidence interval.';
  const longParagraph = `${'Repeated measurements reproduced the control. '.repeat(340)}${tail} ${unvalidated}`;
  const references = 'This reference entry must never be sent to the summary model.';
  const longBibliography = process.argv.includes('--long-bibliography');
  const citations = longBibliography ? 'References ' + require('./mac-parity/good-enough/reader.json').blocks.at(-1).text
    : 'References [1] Ng, A. (2021). Earlier calibration. Journal of Testing.';
  const appendix = 'Appendix A. The team calibrated the sensors again after cold storage.';
  const requests = [];
  let held;
  let regenerate = '';
  let translated = 0;
  const claim = (text, paragraphID, quote) => ({ text, sources: paragraphID ? [{ paragraphID, quote }] : [] });
  const ollama = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ model: summaryModel }, { model: translationModel }] }));
    if (request.url === '/api/ps') return response.end('{"models":[]}');
    if (request.url !== '/api/generate') { response.statusCode = 404; return response.end('{}'); }
    let body = '';
    for await (const chunk of request) body += chunk;
    const { prompt, model, options } = JSON.parse(body);
    const payload = prompt.slice(prompt.indexOf('\n\n') + 2);
    let answer;
    if (prompt.startsWith('Summarize this academic paper excerpt')) {
      requests.push({ kind: 'excerpt', model, payload, options });
      if (payload.includes(numberedHeading)) {
        return response.end(JSON.stringify({ done: true, response: JSON.stringify({ claims: [claim('The paper discusses calibration uncertainty', 1, headingQuote)] }) }));
      }
      if (regenerate === 'cutoff') return response.end('{"response":"Incomplete replacement","done":true,"done_reason":"length"}');
      if (regenerate === 'hold') { held = response; return; }
      answer = { claims: [
        claim('', 2, tail),
        payload.includes(opening) ? claim('Opening procedure', 'P1', 'Model paraphrase') : claim('A measurement was repeated'),
        payload.includes(tail) ? claim('Final limitation', 2, tail.normalize('NFC')) : claim('Reject evidence from a different excerpt', 2, tail),
        claim('Method detail'), claim('Study context')
      ] };
    } else if (prompt.startsWith('Consolidate these partial summary claims')) {
      const candidates = JSON.parse(payload).claims;
      requests.push({ kind: 'merge', model, candidates, options });
      answer = { claims: [
        candidates.find(item => item.text === 'Opening procedure'),
        candidates.find(item => item.text === 'Final limitation') || claim('Interim result'),
        claim('Do not add a new citation during consolidation', 2, unvalidated),
        claim('Retained context')
      ] };
      for (const entry of answer.claims) for (const source of entry.sources) source.quote = source.quote.normalize('NFC');
    } else if (prompt.startsWith('Claim:')) {
      requests.push({ kind: 'quote', model, prompt });
      answer = prompt.startsWith('Claim: Opening procedure') ? `“${opening.normalize('NFC')}”` : tail;
    } else {
      requests.push({ kind: 'translation', model, prompt });
      answer = `摘要译文 ${++translated}`;
    }
    response.end(JSON.stringify({ response: typeof answer === 'string' ? answer : JSON.stringify(answer), done: true }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    onboardingCompletedVersion: 1, autoCheckUpdates: false, summaryModel, translationModel,
    ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`
  }));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const launch = () => electron.launch({ ...(executablePath && { executablePath }), args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + path.join(workspace, 'profile')], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const readSource = async (block, quote = tail) => {
      const label = `Read original block ${block} →`;
      const claim = page.locator('.evidence-claim').filter({ hasText: label });
      if (await claim.getAttribute('open') === null) await claim.locator('summary').click();
      await claim.getByRole('button', { name: label, exact: true }).click();
      await page.waitForFunction(({ block, tail }) => {
        const selection = window.getSelection();
        if (selection?.toString() !== tail || !document.querySelector(`#block-${block} .source-text`)?.contains(selection.anchorNode)) return false;
        const range = selection.getRangeAt(0).getBoundingClientRect();
        const viewport = document.querySelector('.main-scroll').getBoundingClientRect();
        return range.top >= viewport.top && range.bottom <= viewport.bottom;
      }, { block, tail: quote });
    };
    const openSummaryFromMenu = () => app.evaluate(({ Menu, BrowserWindow }) => {
      const command = Menu.getApplicationMenu().getMenuItemById('command:generateSummary');
      if (!command?.enabled) throw new Error('Generate Summary must be available for the open paper');
      command.click(null, BrowserWindow.getAllWindows()[0]);
    });
    const splitOpening = async () => {
      await page.locator('#block-1').getByRole('button', { name: 'Paragraph actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Edit or Split...', exact: true }).click();
      await page.getByRole('textbox', { name: 'Paragraph source' }).fill(`${opening}\n\nAn additional introductory paragraph.`);
      await page.getByRole('dialog', { name: 'Repair Paragraph 1', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    };
    await revealSidebarSource(page);
    await openPasteText(page);
    await page.locator('.paste-area').fill([opening, longParagraph, 'Limitations', 'We could only measure response times in daylight.', citations, references, appendix].join('\n\n'));
    await loadPastedText(page, { view: 'Paper' });
    await openWorkspaceView(page, 'Overview');
    await page.locator('.toolbar-actions').getByRole('button', { name: 'Summarize Paper' }).click();
    await page.getByText('Summary saved. Only exact-match source quotations are linked.', { exact: true }).waitFor();
    assert.equal(await page.locator('.toolbar-actions').getByRole('button', { name: 'Summary Ready' }).isDisabled(), true);
    const summaries = page.locator('.summary-card');
    assert.match(await summaries.first().innerText(), /Final limitation/);
    assert.equal(await summaries.last().locator('li').count(), 4);
    const generatedRequestCount = requests.length;
    await openWorkspaceView(page, 'Reader');
    await openSummaryFromMenu();
    await page.getByText('Opened the saved summary.', { exact: true }).waitFor({ timeout: 5000 });
    assert.match(await summaries.first().innerText(), /Final limitation/);
    assert.equal(requests.length, generatedRequestCount, 'The menu opens a current saved result without calling either model');
    const summaryAppearance = () => summaries.evaluateAll(cards => cards.map(card => {
      const style = getComputedStyle(card);
      return { size: style.fontSize, line: style.lineHeight };
    }));
    const defaultAppearance = await summaryAppearance();
    await page.getByRole('button', { name: 'Reading Appearance', exact: true }).click();
    const appearancePopover = page.getByRole('dialog', { name: 'Reading Appearance', exact: true });
    await appearancePopover.getByRole('slider', { name: 'Reader font size', exact: true }).press('End');
    await appearancePopover.getByRole('slider', { name: 'Line spacing', exact: true }).press('End');
    assert.deepEqual(await summaryAppearance(), Array.from({ length: 2 }, () => ({ size: '24px', line: '40.8px' })));
    await page.keyboard.press('Escape');
    await appearancePopover.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Reading', exact: true }).click();
    await page.getByRole('button', { name: 'Reset Appearance', exact: true }).click();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    assert.deepEqual(await summaryAppearance(), defaultAppearance);
    await page.getByText(/AI-generated summary\. Source links show where quotations appear\./).waitFor();
    await page.setViewportSize({ width: 1800, height: 850 });
    const wideSource = await summaries.first().boundingBox();
    const wideTarget = await summaries.last().boundingBox();
    assert.equal(wideSource.y, wideTarget.y);
    assert.ok(wideTarget.x >= wideSource.x + wideSource.width);
    await page.setViewportSize({ width: 1000, height: 800 });
    const narrowSource = await summaries.first().boundingBox();
    const narrowTarget = await summaries.last().boundingBox();
    assert.equal(narrowSource.x, narrowTarget.x);
    assert.ok(narrowTarget.y >= narrowSource.y + narrowSource.height);
    await page.setViewportSize({ width: 1320, height: 850 });
    const excerpts = requests.filter(item => item.kind === 'excerpt');
    if (longBibliography) {
      for (const title of ['Best Practices for Scientific Computing.', 'Code Review For and By Scientists.']) {
        assert.ok(citations.includes(title));
        assert.ok(excerpts.every(item => !item.payload.includes(title)), 'Reference text reached the summary model: ' + title);
      }
    }
    assert.equal(excerpts.length, 4);
    assert.ok(excerpts.every(item => item.payload.length <= 6000 && !item.payload.includes(references) && !item.payload.includes('Earlier calibration.')));
    assert.match(excerpts.at(-1).payload, /\[P2\][\s\S]*low visibility conditions/);
    assert.ok(excerpts.at(-1).payload.includes('[P3]\nLimitations\n\n[P4]\nWe could only measure response times in daylight.'));
    assert.ok(excerpts.at(-1).payload.includes(appendix));
    const merges = requests.filter(item => item.kind === 'merge');
    assert.equal(merges.length, 3);
    assert.ok(requests.indexOf(merges[0]) < requests.indexOf(excerpts[2]), 'Consolidation must happen before the next source excerpt');
    assert.ok(merges.every(item => item.candidates.length <= 12));
    assert.ok([...excerpts, ...merges].every(item => item.options.num_predict === 2048));
    assert.ok(merges[0].candidates.every(item => item.sources.every(source => source.quote !== tail)), 'An exact quote in the same paragraph but outside the current excerpt is not evidence');
    assert.ok(requests.every(item => item.model === (item.kind === 'translation' ? translationModel : summaryModel)));
    assert.equal(requests.filter(item => item.kind === 'translation').length, 4);
    assert.equal(await page.locator('.evidence-claim button').count(), 2, 'Only the original validated citations survive rolling merges');
    const verified = page.locator('.evidence-claim').filter({ hasText: opening });
    const unverified = page.locator('.evidence-claim').filter({ hasText: 'Retained context' });
    assert.equal(await page.locator('.evidence-claim[open]').count(), 0);
    assert.equal(await verified.getByText(opening, { exact: true }).isVisible(), false);
    await verified.locator('summary').press('Enter');
    await verified.getByText(opening, { exact: true }).waitFor();
    assert.equal(await unverified.getAttribute('open'), null);
    await unverified.locator('summary').click();
    await unverified.getByText('Check the original paper independently before treating this claim as evidence.').waitFor();
    assert.equal(await unverified.getByRole('button').count(), 0);
    await verified.locator('summary').press('Space');
    await verified.getByText(opening, { exact: true }).waitFor({ state: 'hidden' });
    assert.notEqual(await unverified.getAttribute('open'), null);
    await openWorkspaceView(page, 'Reader');
    await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Translation', exact: true }).check();
    await openWorkspaceView(page, 'Overview');
    await readSource(2);
    assert.equal(await page.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: 'Bilingual', exact: true }).isChecked(), true);

    regenerate = 'cutoff';
    await openWorkspaceView(page, 'Overview');
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await page.getByText(/The summary response was cut off/).waitFor();
    assert.match(await summaries.first().innerText(), /Final limitation/);
    regenerate = 'hold';
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    for (let attempt = 0; attempt < 100 && !held; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok(held, 'A replacement request must be in flight before testing Stop');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    held.end('{"response":"Discard late replacement","done":true}');
    await page.getByText('Task cancelled. Completed work was saved.').waitFor();
    assert.match(await summaries.first().innerText(), /Final limitation/);

    const staleNotice = /The source text changed after this summary was generated/;
    await openWorkspaceView(page, 'Reader');
    await splitOpening();
    await openWorkspaceView(page, 'Overview');
    await page.getByText(staleNotice).waitFor();
    regenerate = 'cutoff';
    const beforeRefresh = requests.length;
    await openSummaryFromMenu();
    await page.getByText(/The summary response was cut off/).waitFor();
    assert.ok(requests.length > beforeRefresh, 'The menu still requests a new summary after paper edits');
    await readSource(3);
    await page.getByRole('button', { name: 'Undo last change', exact: true }).click();
    await openWorkspaceView(page, 'Overview');
    assert.equal(await page.getByText(staleNotice).count(), 0);
    await readSource(2);
    await splitOpening();
    await app.close();
    app = null;
    app = await launch();
    page = await app.firstWindow();
    await openWorkspaceView(page, 'Overview');
    await page.getByText(staleNotice).waitFor();
    assert.equal(await page.locator('.evidence-claim[open]').count(), 0);
    await readSource(3);
    const paperDir = path.join(workspace, 'papers');
    const file = fs.readdirSync(paperDir).find(name => /^[a-f\d]{64}\.json$/.test(name));
    const saved = JSON.parse(fs.readFileSync(path.join(paperDir, file), 'utf8'));
    assert.deepEqual(saved.summary.claims.flatMap(item => item.sources), [{ paragraphID: 1, quote: opening }, { paragraphID: 3, quote: tail }]);
    await revealSidebarSource(page);
    await openPasteText(page);
    await page.locator('.paste-area').fill(numberedHeading + '\n\nWe calibrated the same detector under three independent conditions.');
    await loadPastedText(page, { view: 'Paper' });
    await openSummaryFromMenu();
    await page.getByText('Summary saved. Only exact-match source quotations are linked.', { exact: true }).waitFor();
    await readSource(1, headingQuote);
    await page.locator('#block-1.heading-block.current').waitFor();
    // An older Markdown summary can still have validated citations while using damaged scientific notation.
    await app.close(); app = null;
    const legacyId = 'd'.repeat(64);
    const scientific = 'We compare `model_A` and `modelA` using C# and **paired** A* search.';
    const legacyBlock = { id: 1, text: 'We compare modelA and modelA using C and paired A search.', sourceMarkdown: scientific,
      status: 'pending', highlights: [], notes: [] };
    const legacySummary = { source: 'Older comparison.', target: '较早的比较。', sourceLanguage: 'English', targetLanguage: 'Simplified Chinese',
      claims: [claim('Previous comparison', 1, 'We compare modelA and modelA')] };
    const legacyPaper = { ...saved, id: legacyId, name: 'Legacy notation', sourceMode: 'mineru', mineruMarkdown: scientific,
      blocks: [legacyBlock], mineruBlocks: [legacyBlock], summary: legacySummary, position: { tab: 'Reader', block: 1, displayMode: 'bilingual' } };
    fs.writeFileSync(path.join(paperDir, legacyId + '.json'), JSON.stringify(legacyPaper));
    fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id: legacyId }));
    app = await launch(); page = await app.firstWindow();
    await page.getByRole('heading', { name: legacyPaper.name, exact: true }).waitFor();
    regenerate = 'cutoff';
    const beforeLegacy = requests.length;
    await openSummaryFromMenu();
    await page.getByText(/The summary response was cut off/).waitFor({ timeout: 5000 });
    const replacement = requests.slice(beforeLegacy).find(request => request.kind === 'excerpt');
    assert.ok(replacement.payload.includes('model_A and modelA using C# and paired A* search.'));
    assert.equal((await page.evaluate(id => window.paperBridge.loadPaper(id), legacyId)).summary.source, legacySummary.source);
    console.log('Summary verified: saved/current and legacy menu actions, responsive panels, batch-specific citations, cancellation and navigation after split, undo and restart.');
  } finally {
    held?.destroy();
    await app?.close();
    ollama.closeAllConnections();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
