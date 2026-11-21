const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { revealSidebarSource, openWorkspaceView } = require('../sidebar-controls.cjs');

async function importPDF(app, page, name) {
  const filename = path.join(__dirname, name);
  const bytes = fs.readFileSync(filename);
  const id = createHash('sha256').update(bytes).digest('hex');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, filename);
  await revealSidebarSource(page);
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await openWorkspaceView(page, 'Reader');
  const blocks = (await page.evaluate(paperId => window.paperBridge.loadPaper(paperId), id)).blocks;
  return { id, blocks, bytes };
}

async function checkColumnPDF(app, page, prompts) {
  const { id, blocks, bytes } = await importPDF(app, page, 'column-footnote.pdf');
  const text = blocks.map(block => block.text).join('\n');
  const anchors = ['The sensor recorded changes', 'The recorded value agreed',
    'The second trial used', 'The review included', '3.3. Network Architectures',
    'The comparison used', 'Figure 1.', 'The last measurement followed'];
  function orderedAnchors(value) {
    const positions = anchors.map(anchor => {
      const index = value.indexOf(anchor);
      assert.ok(index >= 0, 'Missing ' + anchor + ' in ' + value);
      return { anchor, index };
    });
    return positions.sort((a, b) => a.index - b.index).map(item => item.anchor);
  }
  assert.deepEqual(orderedAnchors(text), anchors);
  assert.ok(!text.includes('Page 1 of 1'));
  const footnote = blocks.find(block => block.text.includes('This note gives'));
  assert.equal(footnote?.pdfFootnoteMarker, '1');
  assert.match(footnote?.text || '', /^1\s*This note gives.*The reference log contains/s);
  const heading = blocks.find(block => block.text === '3.3. Network Architectures');
  assert.equal(heading?.heading, true);
  await revealSidebarSource(page);
  const entry = page.locator('.document-outline .outline-row').filter({ hasText: heading.text });
  await entry.click();
  await page.locator('#block-' + heading.id + '.current').waitFor();
  const reference = process.env.PAPERBRIDGE_MAC_REFERENCE;
  if (reference) {
    const { columnPDF: native, columnPDFSHA256 } = JSON.parse(fs.readFileSync(reference, 'utf8'));
    assert.equal(columnPDFSHA256, id, 'PDFKit and PDF.js opened identical PDF bytes');
    assert.deepEqual(orderedAnchors(native), anchors, 'Reading order from the macOS PDFKit extractor');
    const words = value => value.replace(/1\s*This note/g, '1 This note').trim().split(/\s+/u);
    assert.deepEqual(words(text), words(native), 'All extracted words occur in the same reading order');
    assert.ok(native.includes('instrument calibration date') && native.includes('original reading'));
    assert.ok(!native.includes('Page 1 of 1'), 'macOS excludes the printed folio');
  }
  const savedBytes = await page.evaluate(async paperId => Array.from(await window.paperBridge.readPdf(paperId)), id);
  assert.deepEqual(Buffer.from(savedBytes), bytes);
  assert.equal(prompts.length, 0, 'Import and outline navigation do not call the model');

  const noteRow = page.locator('#block-' + footnote.id);
  await noteRow.getByRole('button', { name: 'Paragraph actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Translate This Paragraph', exact: true }).click();
  await noteRow.getByText('1 校准记录。', { exact: true }).waitFor();
  await openWorkspaceView(page, 'Full Translation');
  await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
  await page.getByText('Connected full-paper translation saved.', { exact: true }).waitFor();
  const paper = await page.evaluate(paperId => window.paperBridge.loadPaper(paperId), id);
  const footnoteBatch = paper.connectedBlocks.find(batch => batch.pdfFootnoteMarker === '1');
  assert.equal(footnoteBatch.output, '1 校准记录。');
  assert.ok(paper.connectedTranslation.includes(footnoteBatch.output));
  const requestsForNote = prompts.filter(prompt => prompt.includes('This note gives the instrument calibration date.'));
  assert.equal(requestsForNote.length, 2, 'Reader and Full Translation both translated the note');
  assert.ok(requestsForNote.every(prompt => !prompt.includes('1This note')));
}

async function checkJournalSidebar(app, page, prompts) {
  const { id, blocks } = await importPDF(app, page, 'emcee-v3.pdf');
  assert.equal(id, '79889217fa1b876c8e8932e6a803b557fab6aaaf47bb55979b00105c4099579a');
  assert.equal(blocks[0].text, 'emcee v3: A Python ensemble sampling toolkit for affine-invariant MCMC');
  assert.ok(blocks[1].text.startsWith('Daniel Foreman-Mackey1, Will M. Farr1, 2, Manodeep Sinha3, 4'));
  assert.ok(blocks[1].text.endsWith('Oriol Abril Pla15'));
  assert.ok(blocks[2].text.includes('Center for Computational Astrophysics') && blocks[2].text.endsWith('Pompeu Fabra, Barcelona'));
  const summary = blocks.findIndex(block => block.text === 'Summary');
  const refs = blocks.findIndex(block => block.text === 'References');
  assert.ok(summary > 3 && refs > summary);
  const metadata = blocks.slice(3, summary).map(block => block.text);
  assert.deepEqual(metadata.filter(text => text.startsWith('•')), ['• Review', '• Repository', '• Archive', '• @benjaminrose', '• @mattpitkin']);
  assert.ok(metadata.join(' ').includes('Submitted: 28 October 2019 Published: 17 November 2019'));
  assert.ok(metadata.join(' ').includes('Creative Commons Attribution'));
  const moves = blocks.findIndex(block => block.text.startsWith('The most important new feature'));
  assert.ok(moves > summary);
  assert.equal(blocks[moves].page, 1);
  assert.equal(blocks[moves].endPage, 2);
  assert.equal((blocks[moves].text.match(/•/g) || []).length, 3);
  assert.ok(blocks[moves + 1].text.startsWith('emcee has been widely used'));
  assert.equal(blocks[moves + 1].page, 2);
  if (process.env.PAPERBRIDGE_MAC_REFERENCE) {
    const native = JSON.parse(fs.readFileSync(process.env.PAPERBRIDGE_MAC_REFERENCE, 'utf8')).publishedPaper;
    assert.deepEqual(blocks.slice(moves, moves + 2).map(block => block.text), native.paragraphs.slice(-2),
      'Both the cross-page list and the following lowercase paragraph match PDFKit');
    const { summarySourceBlocks, summarySourceBatches } = await import('../../src/paper.mjs');
    const batches = summarySourceBatches(summarySourceBlocks(blocks));
    assert.equal(batches.length, native.summaryBatches.length);
    assert.ok(native.summaryBatches.some(batch => /(?:^|\n\n)\[P\d+\]\nSummary(?:\n\n|$)/.test(batch)));
    assert.ok(batches.flat().some(item => item.id === blocks[summary].id && item.text === 'Summary'));
    // The Windows extractor retains the printed sidebar and full byline. Source IDs point into each edition’s own Reader.
    const closingBlocks = blocks.slice(moves - 1, moves + 2);
    assert.deepEqual(batches.at(-1).slice(-3), closingBlocks.map(({ id, text }) => ({ id, text })));
    const nativeClosing = closingBlocks.map(({ text }, i) => `[P${native.paragraphs.length - 2 + i}]\n${text}`).join('\n\n');
    assert.ok(native.summaryBatches.at(-1).endsWith(nativeClosing), 'Each shared closing paragraph has its own summary evidence label');
    assert.ok(batches.flat().every(block => block.id < blocks[refs].id), 'The journal bibliography is excluded');
  }
  const body = blocks.slice(summary + 1, refs).map(block => block.text).join(' ');
  assert.ok(body.startsWith('emcee is a Python library implementing a class of affine-invariant ensemble samplers'));
  assert.doesNotMatch(body, /Published:|Software\s*• Review|Creative Commons Attribution/);
  assert.ok(body.includes('tqdm') && body.includes('h5py') && body.includes('GitHub'));
  const { planConnectedBatches } = await import('../../src/connectedTranslation.mjs');
  const originals = planConnectedBatches(blocks).filter(batch => batch.kind === 'original');
  assert.deepEqual(originals.map(batch => batch.source), blocks.slice(refs).map(block => block.text));
  await openWorkspaceView(page, 'Reader');
  const byline = blocks[1].text;
  const before = prompts.length;
  await page.locator('#block-2').getByRole('button', { name: 'Translate Paragraph', exact: true }).click();
  await page.waitForFunction(({ id, byline }) => window.paperBridge.loadPaper(id).then(paper => paper.blocks[1].translation === byline), { id, byline });
  assert.equal(prompts.length, before);
  await openWorkspaceView(page, 'Full Translation');
  await page.getByRole('button', { name: 'Translate full paper', exact: true }).click();
  await page.getByText('Connected full-paper translation saved.', { exact: true }).waitFor();
  const draft = await page.evaluate(id => window.paperBridge.loadPaper(id), id);
  assert.ok(draft.connectedTranslation.split('\n\n').includes(byline));
  const requests = prompts.slice(before);
  assert.ok(requests.some(prompt => prompt.includes(blocks[0].text)));
  assert.ok(requests.some(prompt => prompt.includes('Center for Computational Astrophysics')));
  assert.ok(requests.every(prompt => !prompt.includes(byline)));
}
module.exports = { checkColumnPDF, checkJournalSidebar };
