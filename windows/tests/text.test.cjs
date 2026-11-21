const test = require('node:test');
const assert = require('node:assert/strict');

test('pasted numbered sections and bibliography entries retain their source text and navigation targets', async () => {
  const { blocksFromText } = await import('../src/text.mjs');
  const { documentOutline } = await import('../src/documentOutline.mjs');
  const { referenceBlockIds } = await import('../src/references.mjs');
  const body = 'The printed flux was stable. 2 Methods The detector was calibrated independently. 3.1 Results The last exposure gave the same reading.';
  const citation = '[1] Martin, A. (2021). Detection limits. Journal of Testing.';
  const blocks = blocksFromText(body + '\n\nReferences ' + citation);
  assert.deepEqual(documentOutline({ blocks }), [{ id: 2, title: '2 Methods' }, { id: 3, title: '3.1 Results' }]);
  assert.deepEqual([...referenceBlockIds(blocks)], [4, 5]);
  assert.equal(blocks[4].text, citation);
  assert.equal(blocks.slice(0, 3).map(block => block.text).join(' '), body);
  for (const source of ['See Fig. 2 Results show a stable reading in these observations.',
    'The reading was stable. 2 methods were used to calibrate the instrument.',
    'A code sample: ' + '\x60done. 2 Methods The detector was calibrated independently.\x60',
    'The literal equation $x. 2 Methods The sample uses this long variable.$ is preserved.',
    'References for our second calibration are available on request.']) {
    assert.deepEqual(blocksFromText(source).map(block => block.text), [source]);
  }
});

test('paste text retains paragraphs and identifies sections', async () => {
  const { blocksFromText, readingMap } = await import('../src/text.mjs');
  const blocks = blocksFromText('Abstract\n\nThis is a source passage with enough content to appear in the reading map and link back to its block.\n\n1 Methods\n\nWe tested a careful procedure with a second long passage that has many words.');
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].heading, true);
  assert.equal(blocks[2].heading, true);
  const guide = readingMap(blocks);
  assert.equal(guide[0].paragraphID, 2);
  assert.deepEqual({ id: guide[0].id, title: guide[0].title, question: guide[0].question, sectionTitle: guide[0].sectionTitle }, {
    id: 'question',
    title: 'The research question',
    question: 'What problem does this paper address?',
    sectionTitle: 'Abstract'
  });
});

test('reading map matches complete normalized headings and never borrows the next section passage', async () => {
  const { readingMap } = await import('../src/text.mjs');
  const blocks = [
    { id: 1, text: 'A Method Mentioned in Context', heading: true },
    { id: 2, text: 'This opening passage is long enough but its custom heading must not be classified as the methods section.', heading: false },
    { id: 3, text: '2 Approach', heading: true },
    { id: 4, text: 'Too short.', heading: false },
    { id: 5, text: 'III. Results', heading: true },
    { id: 6, text: 'The evidence passage belongs only to Results and must never be borrowed by the preceding Approach section.', heading: false },
    { id: 7, text: 'IV. Discussion', heading: true },
    { id: 8, text: 'This discussion passage explains the limits carefully enough to appear as its own exact source excerpt.', heading: false }
  ];
  const guide = readingMap(blocks);
  assert.deepEqual(guide.map(entry => entry.id), ['evidence', 'limits']);
  assert.deepEqual(guide.map(entry => entry.paragraphID), [6, 8]);
  assert.equal(guide.some(entry => entry.id === 'method'), false);
});

test('reading map quotes inline, first-line and explicit Markdown sections with their original block IDs', async () => {
  const { readingMap } = await import('../src/text.mjs');
  const abstract = 'Abstract: We measured the change in two cohorts using the same protocol.';
  const method = '2 Methods\nThese distinct samples were measured twice using independent instruments.';
  const conclusion = 'We observed improved agreement after calibrating the two instruments.';
  const blocks = [
    { id: 1, text: abstract }, { id: 3, text: method }, { id: 4, text: 'Results' },
    { id: 6, text: '🧪'.repeat(39) }, { id: 8, text: 'Concluding remarks', sourceMarkdown: '## Concluding remarks' },
    { id: 10, resource: true, text: 'Diagram caption '.repeat(12) }, { id: 12, text: conclusion },
    { id: 13, text: 'References' }, { id: 14, text: '[1] A long supplementary reference to a separate published paper.' }
  ];
  const guide = readingMap(blocks);
  assert.deepEqual(guide.map(({id, paragraphID, excerpt}) => [id, paragraphID, excerpt]), [
    ['question', 1, abstract], ['method', 3, method], ['conclusion', 12, conclusion]
  ]);
  assert.deepEqual(readingMap(blocks.slice(-2)), []);
  assert.deepEqual(readingMap([{ id: 1, text: '🧪'.repeat(39) }]), []);
  const forty = '🧪'.repeat(40);
  assert.equal(readingMap([{ id: 7, text: forty }])[0].excerpt, forty);
});

test('standalone heading classification keeps heading-plus-body paragraphs translatable', async () => {
  const { blocksFromText, isHeading } = await import('../src/text.mjs');
  assert.equal(isHeading('Abstract'), true);
  assert.equal(isHeading('2 Methods'), true);
  assert.equal(isHeading('A Compact Custom Heading'), true);
  assert.equal(isHeading('Study design', '## Study design'), true);
  assert.equal(isHeading('Study design\nWe retained all evidence.', '## Study design\nWe retained all evidence.'), false);
  assert.equal(isHeading('Abstract. We tested the complete workflow without dropping any evidence.'), false);
  assert.equal(isHeading('2 Methods We retained all evidence from both independent reviewers.'), false);

  const blocks = blocksFromText('Abstract\n\n2 Methods\nWe retained all evidence.\n\nA body paragraph without a final period');
  assert.deepEqual(blocks.map(block => ({ text: block.text, heading: block.heading })), [
    { text: 'Abstract', heading: true },
    { text: '2 Methods\nWe retained all evidence.', heading: false },
    { text: 'A body paragraph without a final period', heading: false }
  ]);
});

test('PDF lines split at headings and preserve page provenance', async () => {
  const { blocksFromLines } = await import('../src/text.mjs');
  const blocks = blocksFromLines([{ text: 'Abstract', x: 0, y: 100, height: 12 }, { text: 'A paper about careful reading.', x: 0, y: 80, height: 12 }, { text: 'It compares passages.', x: 0, y: 68, height: 12 }], 3);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].text, 'A paper about careful reading. It compares passages.');
  assert.equal(blocks[1].page, 3);
});

test('new pasted text uses Mac single-line and multiline spaced-hyphen passes', async () => {
  const { blocksFromText, cleanLine, joinPdfText } = await import('../src/text.mjs');
  const source = 'The natu- ral mea- sure lets our model out- perform the baseline and supports re- search.';
  assert.equal(blocksFromText(source)[0].text, 'The natural measure lets our model outperform the baseline and supports research.');
  assert.equal(blocksFromText('We compare a well- known model- based method with T- cell data and end- to-end training.')[0].text,
    'We compare a well-known model-based method with T-cell data and end-to-end training.');
  assert.equal(blocksFromText('A chain inter- national- based model.')[0].text, 'A chain international- based model.');
  assert.equal(blocksFromText('A chain inter- national- based model.\nMore evidence.')[0].text,
    'A chain international-based model. More evidence.');
  assert.equal(blocksFromText('Abstract\n\nA chain inter- national- based model.')[1].text, 'A chain international-based model.');
  assert.equal(blocksFromText('Re- sults')[0].heading, true);
  assert.equal(blocksFromText('Re- sults\nMore evidence about the observations.')[0].heading, false);
  // Generic cleanup and manual joins do not normalize already saved source.
  assert.equal(cleanLine('Legacy re- sults'), 'Legacy re- sults');
  assert.equal(joinPdfText('Legacy re- sults', 'stay bound to notes.'), 'Legacy re- sults stay bound to notes.');
});

test('PDF lines and manual paragraph merges retain punctuation spacing and annotation offsets', async () => {
  const { joinLines } = await import('../src/text.mjs');
  const { mergeBlocks } = await import('../src/paper.mjs');
  assert.equal(joinLines(['Ratio (', 'A/', 'B', ')', ', measured twice.']), 'Ratio (A/B), measured twice.');
  assert.equal(joinLines(['结果', '，见图一。']), '结果，见图一。');
  const marked = { text: 'test', offset: 2, color: 'amber' };
  const merged = mergeBlocks({ text: 'Result', notes: [] }, { text: ', test.', highlights: [marked] });
  assert.equal(merged.text, 'Result, test.');
  assert.equal(merged.highlights[0].offset, 8);
  assert.equal(merged.highlights[0].needsReview, false);
});

test('PDF item reconstruction repairs spaced fragments without changing line geometry', async () => {
  const { pageLines } = await import('../src/pdfLayout.mjs');
  const { blocksFromLines } = await import('../src/text.mjs');
  const item = (str, x, width) => ({ str, transform: [12, 0, 0, 12, x, 720], width, height: 12 });
  const lines = pageLines({ items: [
    item('We report re-', 42, 72), item(' ', 114, 3), item('sults from an attention-', 117, 125),
    item(' ', 242, 3), item('based model.', 245, 72)
  ] }, [0, 0, 612, 792]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'We report results from an attention-based model.');
  assert.deepEqual({ x: lines[0].x, y: lines[0].y, width: lines[0].width, height: lines[0].height },
    { x: 42, y: 720, width: 275, height: 12 });
  assert.equal(blocksFromLines(lines, 3)[0].text, lines[0].text);
  assert.equal(blocksFromLines(lines, 3)[0].page, 3);
});

test('import stages preserve ICU whitespace boundaries and remove soft hyphens at the Mac stage', async () => {
  const { blocksFromLines, blocksFromText, finishExtractedPdfText } = await import('../src/text.mjs');
  const { pageLines } = await import('../src/pdfLayout.mjs');
  const source = 'Boundary re-\ufeffsults and re-\u0085sults plus re- sults\u00ad.';
  const lines = pageLines({ items: [{ str: source, transform: [12, 0, 0, 12, 42, 720], width: 400, height: 12 }] }, [0, 0, 612, 792]);
  const paragraph = blocksFromLines(lines, 1)[0].text;
  assert.equal(paragraph, 'Boundary re-\ufeffsults and results plus re- sults\u00ad.');
  assert.equal(finishExtractedPdfText(paragraph), 'Boundary re-\ufeffsults and results plus results.');
  assert.equal(blocksFromText(source)[0].text, 'Boundary re-\ufeffsults and results plus re- sults\u00ad.');
  assert.equal(blocksFromText(source + '\nMore evidence.')[0].text, 'Boundary re-\ufeffsults and results plus results. More evidence.');
});

test('raised numbers follow their attached word or formula on the same PDF line', async () => {
  const { pageLines } = await import('../src/pdfLayout.mjs');
  const item = (str, x, y, width, height) => ({ str, transform: [height, 0, 0, height, x, y], width, height });
  const items = [
    item('Runtime O(n', 80, 610, 65, 12), item('2', 145, 614, 4, 7), item(' · d).', 149, 610, 32, 12),
    item('Proceedings', 80, 590, 66, 12), item('1, 3', 146, 594, 10, 7), item(', Basel.', 156, 590, 42, 12),
    item('4', 290, 594, 5, 7)
  ];
  const lines = pageLines({ items }, [0, 0, 600, 800]).map(line => line.text);
  assert.ok(lines.includes('Runtime O(n2 · d).'));
  assert.ok(lines.includes('Proceedings1, 3, Basel.'));
  assert.ok(lines.includes('4'), 'An unconnected number is not appended to a distant word');
});

test('PDF reading order separates narrow-gutter columns around spanning text and retains PDF spaces', async () => {
  const { pageLines, pdfReadingGroups } = await import('../src/pdfLayout.mjs');
  const item = (str, x, y, width, vertical = false) => ({
    str, transform: [...(vertical ? [0, 10, -10, 0] : [10, 0, 0, 10]), x, y], width, height: 10
  });
  const leftUpper = Array.from({ length: 6 }, (_, i) => item('Left side records results from trial ' + i, 66, 740 - 12 * i, 234));
  const rightUpper = leftUpper.map(({ transform }, i) => item('Right side reports values from trial ' + i, 329, transform[5], 218));
  const lowerLeft = item('Left side continues after the shared table.', 66, 610, 236);
  const lowerRight = item('Right side continues after the shared table.', 329, 610, 224);
  const title = item('Shared title across the whole page', 122, 770, 355);
  const table = item('Table 1. Shared measurements across the whole page.', 90, 650, 425);
  const stamp = item('arXiv:1234.5678', 42, 716, 257, true);
  const items = [
    ...rightUpper, lowerRight, stamp, title,
    item('ImageNet', 66, 740, 43),
    item(' ', 109, 740, 1.5),
    item('trial records reproducible baseline results', 110.5, 740, 189.5),
    ...leftUpper.slice(1), table, lowerLeft
  ];
  const lines = pageLines({ items }, [20, 30, 632, 822]);
  assert.deepEqual(pdfReadingGroups(lines).map(group => group.map(line => line.text)), [
    [title.str],
    ['ImageNet trial records reproducible baseline results', ...leftUpper.slice(1).map(item => item.str)],
    rightUpper.map(item => item.str),
    [table.str],
    [lowerLeft.str],
    [lowerRight.str]
  ]);
});

test('short cell labels do not make a single-column PDF into two columns', async () => {
  const { pageLines, pdfReadingGroups } = await import('../src/pdfLayout.mjs');
  const item = (str, x, y, width) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });
  const rows = Array.from({ length: 8 }, (_, i) => [
    item('ID ' + i, 60, 750 - 12 * i, 224),
    item('100', 322, 750 - 12 * i, 220)
  ]).flat();
  const text = item('A regular paragraph resumes underneath the table.', 60, 630, 470);
  const lines = pageLines({ items: [...rows, text] }, [0, 0, 612, 792]);
  assert.deepEqual(pdfReadingGroups(lines), [lines]);
  assert.equal(lines.at(-1).text, text.str);
});

test('long text is chunked without losing characters', async () => {
  const { chunkText } = await import('../src/text.mjs');
  const text = 'First sentence. Second sentence. Third sentence.';
  assert.equal(chunkText(text, 20).join(' ').replace(/\s+/g, ' ').trim(), text);
});

test('small raised note markers start a separate footnote only near the foot of the page', async () => {
  const { pageLines } = await import('../src/pdfLayout.mjs');
  const { blocksFromLines } = await import('../src/text.mjs');
  const item = (str, x, y, height, width) => ({ str, height, width, transform: [height, 0, 0, height, x, y] });
  const region = (y, markerY) => [
    item('Context from the body with continuing text', 45, y + 26, 10, 220),
    item('continues here with further observations', 45, y + 15, 10, 215),
    item('2', 50, y + markerY, 6, 3), item('This line supplies a qualification', 53.5, y, 8, 125),
    item('and its continuation.', 45, y - 9, 8, 100)
  ];
  for (const [y, markerY, separate] of [[85, 2.8, true], [385, 2.8, false], [85, 0, false]]) {
    const lines = pageLines({ items: region(y, markerY) }, [0, 0, 612, 792]);
    const blocks = blocksFromLines(lines, 1);
    assert.equal(blocks.length, separate ? 2 : 1);
    if (separate) assert.equal(blocks[1].text, '2This line supplies a qualification and its continuation.');
  }
});

test('only PDF-marked footnotes keep their number outside the model input, including retries and manual splits', async () => {
  const { pdfFootnoteMarker } = await import('../src/text.mjs');
  const { splitBlockAt } = await import('../src/paper.mjs');
  const { planConnectedBatches, connectedRetryExcerpts } = await import('../src/connectedTranslation.mjs');
  const first = '2This note describes the instrument.';
  const tail = '2D imaging confirmed the estimate.';
  const block = { id: 2, text: first + ' ' + tail, pdfFootnoteMarker: '2' };
  assert.equal(pdfFootnoteMarker(block), '2');
  const [left, right] = splitBlockAt(block, first.length);
  assert.equal(pdfFootnoteMarker(left), '2');
  assert.equal(pdfFootnoteMarker(right), '');
  assert.equal(pdfFootnoteMarker({ ...block, text: '5This label was edited.' }), '');
  assert.equal(pdfFootnoteMarker({ text: '2D imaging is useful.' }), '');
  const batches = planConnectedBatches([{ id: 1, text: 'Previous paragraph.' }, block, { id: 3, text: tail }]);
  assert.deepEqual(batches.map(b => b.source), ['Previous paragraph.', block.text, tail]);
  assert.equal(batches[1].pdfFootnoteMarker, '2');
  for (const retry of [true, false]) assert.deepEqual(connectedRetryExcerpts(batches[1], retry),
    [{ source: block.text.slice(1), separator: '' }]);
});

test('standalone printed folios are removed without dropping nearby table or equation values', async () => {
  const { filterRepeatedPageDecorations } = await import('../src/pdfDecorations.mjs');
  const line = (text, y) => ({ text, x: 42, y, height: 10 });
  const filtered = lines => filterRepeatedPageDecorations([{ height: 792, lines }])[0].lines.map(item => item.text);
  for (const folio of ['12', '(12)', 'Page 12 of 18']) {
    assert.deepEqual(filtered([line('A retained footnote.', 78), line(folio, 40)]), ['A retained footnote.']);
  }
  assert.deepEqual(filtered([line('Page 12 of 18', 400)]), ['Page 12 of 18']);
  assert.deepEqual(filtered([line('Measured value', 60), line('12', 60)]), ['Measured value', '12']);
  assert.deepEqual(filtered([line('x + y', 56), line('(3)', 53)]), ['x + y', '(3)']);
});

test('repeated PDF running heads and page footers leave the first header and all body text', async () => {
  const { filterRepeatedPageDecorations } = await import('../src/pdfDecorations.mjs');
  const pages = [1, 2, 3].map(number => ({ width: 600, height: 800, lines: [
    { text: 'Journal of Reading 2026', y: 770, height: 12 },
    { text: `Unique body paragraph ${number}`, y: 390, height: 12 },
    { text: `Page ${number}`, y: 30, height: 12 }
  ] }));
  const result = filterRepeatedPageDecorations(pages);
  assert.deepEqual(result.map(page => page.lines.map(line => line.text)), [
    ['Journal of Reading 2026', 'Unique body paragraph 1'],
    ['Unique body paragraph 2'],
    ['Unique body paragraph 3']
  ]);
});

test('PDF page stitching repairs an interrupted word but keeps complete sentences separate', async () => {
  const { stitchPageBlocks } = await import('../src/pdfDecorations.mjs');
  const blocks = stitchPageBlocks([
    { id: 1, page: 1, text: 'The paper describes a reproducible metho-' },
    { id: 2, page: 2, text: 'dology for this experiment.' },
    { id: 3, page: 2, text: 'Results end here.' },
    { id: 4, page: 3, text: 'A new section starts.' }
  ]);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].text, 'The paper describes a reproducible methodology for this experiment.');
  assert.equal(blocks[0].endPage, 2);
  assert.equal(blocks[1].text, 'Results end here.');
});

test('PDF line and page wrapping preserve compound hyphens and separate paragraphs on the same page', async () => {
  const { joinLines } = await import('../src/text.mjs');
  const { stitchPageBlocks } = await import('../src/pdfDecorations.mjs');
  assert.equal(joinLines(['It uses attention-', 'based inference and repro-', 'ducible evaluation.']), 'It uses attention-based inference and reproducible evaluation.');
  assert.equal(joinLines(['A state-of-the-', 'art model at low‐', 'resolution.']), 'A state-of-the-art model at low‐resolution.');
  assert.equal(joinLines(['The English-', 'to-German and end-', 'to-end tasks.']), 'The English-to-German and end-to-end tasks.');
  assert.equal(joinLines(['an inter-', 'national-based comparison']), 'an international-based comparison');
  const blocks = stitchPageBlocks([
    { page: 1, text: 'The paper proposes attention-' },
    { page: 2, text: 'based inference with a slower alternative' },
    { page: 2, text: 'another paragraph belongs to this page.' }
  ]);
  assert.deepEqual(blocks.map(({ text, page, endPage }) => ({ text, page, endPage })), [
    { text: 'The paper proposes attention-based inference with a slower alternative', page: 1, endPage: 2 },
    { text: 'another paragraph belongs to this page.', page: 2, endPage: undefined }
  ]);
});
