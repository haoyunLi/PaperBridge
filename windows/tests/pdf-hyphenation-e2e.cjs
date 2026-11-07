const { revealSidebarSource } = require('./sidebar-controls.cjs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const ordinary = 'The natu- ral mea- sure lets our model out- perform the baseline and supports re- search.';
const compounds = 'We compare a well- known model- based method with T- cell data and end- to-end training.';
const fourPassChain = 'aa- bb- cc- dd- ee- ff- gg- hh- ii- jj- kk- ll- mm- nn- oo- pp';
const expectedLines = [
  'We report results from an attention-based inference.',
  'The natural measure lets our model outperform the baseline and supports research.',
  'We compare a well-known model-based method with T-cell data and end-to-end training.',
  'A state-of-the-art model uses international-based controls.',
  'Math tokens x- y and x - y plus re- Sults remain as written.',
  'Four-pass boundary aabbccddeeffgghhiijjkkllmmnnoopp remains stable.'
];

function fixturePdf(legacy = false) {
  // The blank spaces use a separate font to force distinct PDF text items. They
  // must survive PDF.js item reconstruction before the PDF-only repair runs.
  const stream = legacy
    ? 'BT /F1 12 Tf 42 720 Td (Legacy re- sults remain bound to their original annotations.) Tj ET'
    : [
      'BT /F1 16 Tf 42 740 Td (Spaced PDF fragments) Tj ET',
      'BT /F1 10 Tf 42 690 Td (We report re-) Tj /F2 10 Tf ( ) Tj /F1 10 Tf (sults from an attention-) Tj /F2 10 Tf ( ) Tj /F1 10 Tf (based inference.) Tj ET',
      `BT /F1 10 Tf 42 640 Td (${ordinary}) Tj ET`,
      `BT /F1 10 Tf 42 590 Td (${compounds}) Tj ET`,
      'BT /F1 10 Tf 42 540 Td (A state-of-the- art model uses inter- national- based controls.) Tj ET',
      'BT /F1 10 Tf 42 490 Td (Math tokens x- y and x - y plus re- Sults remain as written.) Tj ET',
      `BT /F1 8 Tf 42 440 Td (Four-pass boundary ${fourPassChain} remains stable.) Tj ET`
    ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

async function waitFor(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch { /* Atomic save or rendering in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(artifacts, 'pdf-hyphenation-'));
  fs.mkdirSync(path.join(workspace, 'papers'));
  fs.mkdirSync(path.join(workspace, 'pdfs'));
  const bytes = fixturePdf(), id = sha256(bytes);
  const importFile = path.join(workspace, 'spaced-fragments.pdf');
  fs.writeFileSync(importFile, bytes);

  // Assert the fixture really contains same-line fragment/space/fragment items;
  // the app below still imports and extracts the PDF through its real renderer.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false,
    standardFontDataUrl: path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts').replaceAll('\\', '/') + '/' });
  const pdf = await loading.promise;
  let sourceItems;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    sourceItems = content.items.filter(item => typeof item.str === 'string' && item.str !== '').map(item => ({ text: item.str, y: item.transform[5] }));
    const line = sourceItems.filter(item => Math.abs(item.y - 690) < 0.1).map(item => item.text);
    assert.deepEqual(line, ['We report re-', ' ', 'sults from an attention-', ' ', 'based inference.']);
  } finally { await loading.destroy(); }

  let generationRequests = 0;
  const ollama = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/generate') generationRequests++;
    response.end(JSON.stringify({ models: [] }));
  });
  await new Promise(resolve => ollama.listen(0, '127.0.0.1', resolve));
  const settings = { ollamaBaseURL: `http://127.0.0.1:${ollama.address().port}`, pdfExtractionMode: 'pdfOnly',
    autoCheckUpdates: false, onboardingCompletedVersion: 1, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese' };
  const legacyBytes = fixturePdf(true), legacyId = sha256(legacyBytes);
  const legacyText = 'Legacy re- sults remain bound to their original annotations.';
  const quote = 're- sults', offset = legacyText.indexOf(quote);
  const note = { id: 'legacy-source-note', scope: 'reader', kind: 'source', text: quote, offset, body: 'Keep the exact legacy source fragment.' };
  const highlight = { scope: 'reader', text: quote, offset, color: 'amber' };
  const legacyBlocks = [{ id: 1, page: 1, text: legacyText, heading: false, translation: 'Saved legacy translation.',
    status: 'ok', bookmark: true, highlights: [highlight], translationHighlights: [], notes: [note] }];
  const legacy = { id: legacyId, name: 'Legacy spaced PDF', type: 'pdf', sourceMode: 'pdf', extraction: 'PDF.js',
    createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', inspectorOpen: true,
    blocks: legacyBlocks, pdfBlocks: legacyBlocks, taskSettings: settings,
    position: { tab: 'Reader', block: 1, page: 1, displayMode: 'bilingual' } };
  const paperFile = paperId => path.join(workspace, 'papers', `${paperId}.json`);
  const readPaper = paperId => JSON.parse(fs.readFileSync(paperFile(paperId), 'utf8'));
  fs.writeFileSync(paperFile(legacyId), JSON.stringify(legacy));
  fs.writeFileSync(path.join(workspace, 'pdfs', `${legacyId}.pdf`), legacyBytes);
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify(settings));
  fs.writeFileSync(path.join(workspace, 'last-paper.json'), JSON.stringify({ id: legacyId }));

  let app, page;
  const launch = async () => {
    app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 900 });
  };
  const assertLegacy = async () => {
    await page.getByRole('heading', { name: legacy.name, exact: true }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    assert.equal(await page.locator('#block-1 .source-text').textContent(), legacyText);
    assert.equal(await page.locator('#block-1 .source-text mark').textContent(), quote);
    await page.locator('.saved-annotations .annotation-row').filter({ hasText: note.body }).locator('button').first().click();
    await page.waitForFunction(quote => window.getSelection()?.toString() === quote, quote);
    assert.equal(await page.getByRole('textbox', { name: 'Note for selected passage', exact: true }).inputValue(), note.body);
    const saved = readPaper(legacyId);
    for (const source of [saved.blocks, saved.pdfBlocks]) {
      assert.deepEqual(source.map(block => ({ id: block.id, text: block.text, highlights: block.highlights, notes: block.notes })),
        legacyBlocks.map(block => ({ id: block.id, text: block.text, highlights: block.highlights, notes: block.notes })));
    }
    assert.equal(saved.id, legacyId);
    assert.equal(saved.sourceMode, 'pdf');
    assert.deepEqual(fs.readFileSync(path.join(workspace, 'pdfs', `${legacyId}.pdf`)), legacyBytes);
  };
  const assertPasted = async (text, expected) => {
    const pastedId = sha256(text);
    await revealSidebarSource(page);
    await page.getByRole('button', { name: 'Paste Text', exact: true }).click();
    await page.locator('.paste-area').fill(text);
    await page.getByRole('button', { name: 'Open text', exact: true }).click();
    await page.getByRole('heading', { name: 'Pasted Text', exact: true }).waitFor();
    await waitFor(() => fs.existsSync(paperFile(pastedId)), 'pasted source saved');
    assert.deepEqual(readPaper(pastedId).blocks.map(block => block.text), expected);
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    assert.deepEqual(await page.locator('.source-text').allTextContents(), expected);
  };
  try {
    await launch();
    await assertLegacy();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, importFile);
    await revealSidebarSource(page);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
    await waitFor(() => fs.existsSync(paperFile(id)), 'new PDF extraction saved', 30000);
    await page.locator('.import-progress-screen').waitFor({ state: 'detached', timeout: 30000 });
    await page.getByRole('heading', { name: 'spaced-fragments.pdf', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    const imported = readPaper(id);
    assert.equal(imported.sourceMode, 'pdf');
    assert.equal(imported.extraction, 'PDF.js');
    const extracted = imported.blocks.map(block => block.text);
    for (const expected of expectedLines) {
      assert.ok(extracted.includes(expected), `Missing extracted paragraph: ${expected}\n${extracted.join('\n')}`);
      await page.locator('.source-text').getByText(expected, { exact: true }).waitFor();
    }
    assert.deepEqual(imported.pdfBlocks.map(block => block.text), extracted);
    assert.deepEqual(fs.readFileSync(path.join(workspace, 'pdfs', `${id}.pdf`)), bytes);
    await page.screenshot({ path: path.join(workspace, 'repaired-reader.png') });

    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.textLayer[data-page="1"]'));
    const originalText = await page.locator('.textLayer[data-page="1"]').textContent();
    assert.ok(originalText.includes('We report re- sults from an attention- based inference.'));
    assert.ok(originalText.includes(ordinary));
    assert.ok(originalText.includes(compounds));

    // Mac chooses one or two repair passes from the whole pasted document's
    // newline presence, so the single-line branch needs its own import.
    await assertPasted('A model uses inter- national- based controls.', ['A model uses international- based controls.']);
    const pastedParts = [
      'Literal re- sults and attention- based text are newly pasted.', ordinary, compounds,
      'A model uses inter- national- based controls.',
      'A model uses inter- national- based controls.\nIt continues with reliable observations.'
    ];
    const expectedPasted = [
      'Literal results and attention-based text are newly pasted.', expectedLines[1], expectedLines[2],
      'A model uses international-based controls.',
      'A model uses international-based controls. It continues with reliable observations.'
    ];
    await assertPasted(pastedParts.join('\n\n'), expectedPasted);

    await page.locator('.library-row').filter({ hasText: legacy.name }).click();
    await assertLegacy();
    await app.close(); app = null;
    await launch();
    await assertLegacy();
    assert.equal(generationRequests, 0, 'PDF extraction and saved-source verification must not invoke AI');
    const result = { passed: true, workspace, importedId: id, legacyId, sourceItems, extracted,
      checked: ['actual split PDF items', 'same-line ordinary repairs', 'compound hyphens', 'four PDF repair passes', 'unmatched math and case tokens',
        'Reader text and PDF source snapshot', 'original PDF bytes and text layer', 'legacy source IDs and annotation navigation', 'new paste single-line and multiline repairs', 'restart'] };
    fs.writeFileSync(path.join(workspace, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(workspace, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.close();
    await new Promise(resolve => ollama.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
