const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { revealSidebarSource, openWorkspaceView } = require('../sidebar-controls.cjs');

async function checkColumnPDF(app, page) {
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
    'The last measurement followed', 'The second trial used', 'The review included',
    '3.3. Network Architectures', 'The comparison used', 'Figure 1.'];
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
    // PDFKit places the isolated lower-left passage after the right-column
    // caption. Windows finishes its left column first. Both preserve the two
    // continuous columns, subsection and caption in their original order.
    const lowerLeft = 'The last measurement followed';
    assert.deepEqual(orderedAnchors(native), [...anchors.filter(anchor => anchor !== lowerLeft), lowerLeft]);
    const words = value => value.replace(/1\s*This note/g, '1 This note').trim().split(/\s+/u).sort();
    assert.deepEqual(words(text), words(native), 'Every word survives both native imports');
    assert.ok(native.includes('instrument calibration date') && native.includes('original reading'));
    assert.ok(!native.includes('Page 1 of 1'), 'macOS excludes the printed folio');
  }
  const savedBytes = await page.evaluate(async paperId => Array.from(await window.paperBridge.readPdf(paperId)), id);
  assert.deepEqual(Buffer.from(savedBytes), bytes);
}

module.exports = { checkColumnPDF };
