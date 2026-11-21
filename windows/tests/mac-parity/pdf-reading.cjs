const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { revealSidebarSource, openWorkspaceView } = require('../sidebar-controls.cjs');

async function checkColumnPDF(app, page, prompts) {
  const filename = path.join(__dirname, 'column-footnote.pdf');
  const bytes = fs.readFileSync(filename);
  const id = createHash('sha256').update(bytes).digest('hex');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, filename);
  await revealSidebarSource(page);
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await page.getByRole('heading', { name: 'column-footnote.pdf', exact: true }).waitFor();
  await openWorkspaceView(page, 'Reader');
  const blocks = (await page.evaluate(paperId => window.paperBridge.loadPaper(paperId), id)).blocks;
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

module.exports = { checkColumnPDF };
