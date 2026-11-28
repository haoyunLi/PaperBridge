const test = require('node:test');
const assert = require('node:assert/strict');

test('cross-page bullets continue an unfinished list and preserve the following body paragraph', async () => {
  const { blocksFromLines } = await import('../src/text.mjs');
  const { stitchPageBlocks } = await import('../src/pdfDecorations.mjs');
  const row = (text, x, y) => ({ text, x, y, height: 10 });
  const items = blocksFromLines([row('• The second option uses a', 30, 100), row('different kernel.', 42, 88),
    row('lowercase prose begins at the body margin.', 18, 70)], 2);
  assert.equal(items.length, 2);
  const previous = { page: 1, text: 'The options include: • The first kernel,' };
  const joined = stitchPageBlocks([previous, ...items]);
  assert.equal(joined.length, 2);
  assert.equal(joined[0].endPage, 2);
  assert.equal(joined[1].text, 'lowercase prose begins at the body margin.');
  assert.equal(stitchPageBlocks([{ ...previous, text: previous.text + ' and' }, ...items]).length, 2);
  // A trailing comma alone, a complete list, or a skipped page is insufficient.
  for (const left of ['The sample mean increased,', 'These are the options: • A finished list.']) {
    assert.equal(stitchPageBlocks([{ page: 1, text: left }, ...items]).length, 3);
  }
  assert.equal(stitchPageBlocks([{ ...previous, page: 0 }, ...items]).length, 3);
  const aligned = blocksFromLines([row('• The first sentence.', 30, 100), row('another sentence of that item.', 42, 82)], 2);
  assert.equal(aligned.length, 1);
});

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

test('an inline Computer Modern summation stays in its footnote with independent limits and variable indices', async () => {
  const { recoverInlineSummations, pageLines } = await import('../src/pdfLayout.mjs');
  const { blocksFromLines } = await import('../src/text.mjs');
  const { stitchPageBlocks } = await import('../src/pdfDecorations.mjs');
  const glyph = (str, x, y, height, width, fontName = 'roman') => ({ str, transform: [height, 0, 0, height, x, y], height, width, fontName });
  const content = { items: [
    glyph('The heads produce independent', 50, 101, 10, 148),
    glyph('4', 62, 87, 6, 3), glyph('The measured product is', 65, 83, 9, 102),
    glyph('equal to', 50, 72, 9, 32), glyph('=', 85, 72, 9, 5),
    glyph('P', 93, 78.7, 9, 10, 'extension'), glyph('d', 103, 76.3, 6, 4, 'italic'),
    glyph('k', 107, 74.9, 5, 3, 'italic'), glyph('i', 103, 69.2, 6, 3, 'italic'), glyph('=1', 106, 69.2, 6, 7),
    glyph('q', 115, 72, 9, 4, 'italic'), glyph('i', 119, 71, 6, 3, 'italic'),
    glyph('k', 123, 72, 9, 5, 'italic'), glyph('i', 128, 71, 6, 3, 'italic'), glyph('.', 132, 72, 9, 3)
  ] };
  const original = structuredClone(content);
  const fonts = new Map([['extension', { name: 'ABCDEF+CMEX9' }], ['italic', { name: 'CMMI9' }], ['roman', { name: 'CMR9' }]]);
  const page = { getOperatorList: async () => {}, commonObjs: fonts };
  const recovered = await recoverInlineSummations(page, content);
  const extracted = blocksFromLines(pageLines(recovered, [0, 0, 612, 792]), 4);
  const outside = { id: 3, page: 5, text: 'output values.' };
  const following = { id: 4, page: 5, text: 'these measurements belong to a separate paragraph.' };
  const blocks = stitchPageBlocks([...extracted, outside, following]);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].text, 'The heads produce independent output values.');
  assert.equal(blocks[0].endPage, 5);
  assert.equal(blocks[1].pdfFootnoteMarker, '4');
  assert.equal(blocks[1].text, '4The measured product is equal to = ∑_{i=1}^{d_{k}} q_{i} k_{i}.');
  assert.equal(blocks[2].text, following.text, 'Only the first physical block on the new page can continue the preceding page');
  assert.deepEqual(content, original);
  fonts.set('extension', { name: 'CMR9' });
  assert.deepEqual(await recoverInlineSummations(page, content), original);
  const distant = structuredClone(original);
  distant.items[10].transform[4] += 80;
  fonts.set('extension', { name: 'CMEX9' });
  assert.deepEqual(await recoverInlineSummations(page, distant), distant);
});

test('a raised TeX code star follows its monospace row without changing other fonts or the original layer', async () => {
  const { recoverCodeAsterisks, pageLines } = await import('../src/pdfLayout.mjs');
  const item = (str, x, y, height, width, fontName) => ({ str, transform: [height, 0, 0, height, x, y], height, width, fontName });
  const content = { styles: { code: { fontFamily: 'monospace' } }, items: [
    item('scan', 24, 100, 10, 24, 'code'), item(' ', 48, 100, 0, 1, 'code'),
    item('\x03', 51, 104, 7, 3, 'math'), item('.dat', 54, 100, 10, 24, 'code')
  ] };
  const page = { getOperatorList: async () => {}, commonObjs: new Map([['math', { name: 'AABBCC+TeX_CM_Maths_Symbols' }]]) };
  const fixed = await recoverCodeAsterisks(page, content);
  assert.equal(pageLines(fixed, [0, 0, 300, 300])[0].text, 'scan *.dat');
  assert.equal(content.items[2].str, '\x03');
  assert.equal(content.items[2].transform[5], 104);
  page.commonObjs.get('math').name = 'Unknown symbols';
  assert.deepEqual(await recoverCodeAsterisks(page, content), content);
  const unreadable = { ...page, getOperatorList() { throw new Error('unavailable'); } };
  assert.equal(await recoverCodeAsterisks(unreadable, content), content);
});

test('PDF code listings retain physical lines and indentation without treating all fixed-pitch prose as code', async () => {
  const { blocksFromLines } = await import('../src/text.mjs');
  const line = (text, x, y) => ({ x, y, width: text.length * 6, height: 10, text, codeText: text, codeCellWidth: 6 });
  const blocks = blocksFromLines([line('def read():', 24, 100), line('return "~~~"', 48, 88), line('See the legend.', 24, 54)], 1);
  assert.equal(blocks[0].text, 'def read():\n    return "~~~"');
  assert.equal(blocks[0].heading, false);
  assert.ok(blocks[0].sourceMarkdown.includes(blocks[0].text));
  assert.equal(blocks[1].sourceMarkdown, undefined);
  const ordinary = blocksFromLines([line('The observations continued', 24, 100), line('through the evening.', 24, 88)], 1);
  assert.equal(ordinary[0].text, 'The observations continued through the evening.');
  assert.equal(ordinary[0].sourceMarkdown, undefined);
});

test('overprinted copyright glyphs produce one symbol and ordinary following text remains present', async () => {
  const { pageLines } = await import('../src/pdfLayout.mjs');
  const item = (str, x, width) => ({ str, width, height: 9, transform: [9, 0, 0, 9, x, 30] });
  const items = [item('c', 122, 4), item('©', 120, 9), item('2019', 129, 18), item('c', 151, 4)];
  assert.equal(pageLines({ items }, [0, 0, 600, 800])[0].text, '©2019 c');
});

test('a first-page proceedings imprint stays with the byline and out of a continued body paragraph', async () => {
  const { pdfReadingGroups } = await import('../src/pdfLayout.mjs');
  const line = (text, lane, x, width, y, height = 10) => ({ text, lane, x, width, y, height });
  const lines = [
    line('A multiline article', 'spanning', 100, 400, 750, 14),
    line('title', 'spanning', 250, 100, 734, 14),
    line('A. Reyes', 'left', 130, 55, 701), line('B. Kim', 'right', 304, 45, 701),
    line('Abstract', 'left', 150, 45, 620), line('Second column', 'right', 304, 175, 618),
    line('First column', 'left', 72, 200, 606),
    line('Proceedings of the conference, pages 101–110', 'spanning', 120, 360, 40),
    line('© 2020 Publisher', 'spanning', 225, 150, 28)
  ];
  const text = (rows, pageNumber = 1) => pdfReadingGroups(rows, { pageNumber, height: 800 }).map(g => g.map(l => l.text).join(' '));
  assert.deepEqual(text(lines), ['A multiline article title', 'A. Reyes B. Kim',
    'Proceedings of the conference, pages 101–110 © 2020 Publisher', 'Abstract First column', 'Second column']);
  assert.ok(text(lines, 2).at(-1).startsWith('Proceedings of'));
  assert.ok(text(lines.slice(0, -1)).at(-1).startsWith('Proceedings of'));
});

test('TeX vector dimensions, indexed variables and ordinals stay attached only at their printed offsets', async () => {
  const { recoverMathScripts } = await import('../src/pdfLayout.mjs');
  const glyph = (str, x, y, height, fontName) => ({ str, width: 5, height, fontName, transform: [height, 0, 0, height, x, y] });
  const items = [glyph('i', 10, 50, 10, 'var'), glyph('th', 15, 54, 7, 'roman'),
    glyph('T', 30, 50, 10, 'var'), glyph('i', 35, 48, 7, 'var'), glyph('∈', 43, 50, 10, 'symbols'),
    glyph('R', 53, 50, 10, 'space'), glyph('K', 58, 54, 7, 'var'), glyph('×', 63, 54, 7, 'symbols'),
    glyph('H', 68, 54, 7, 'var'), glyph('.', 76, 50, 10, 'text')];
  const fonts = new Map(Object.entries({ space: 'ABCDEF+MSBM10', var: 'CMMI10', symbols: 'CMSY8', roman: 'CMR8', text: 'Times' })
    .map(([key, name]) => [key, { name }]));
  const page = { getOperatorList: async () => {}, commonObjs: fonts };
  const recovered = await recoverMathScripts(page, { items });
  assert.deepEqual(recovered.items.map(i => i.str).filter(Boolean), ['i^{th}', 'T_{i}', '∈', 'ℝ^{K×H}', '.']);
  const ordinary = items.map(i => ({ ...i, fontName: 'text' }));
  assert.deepEqual((await recoverMathScripts(page, { items: ordinary })).items, ordinary);
  const gap = items.slice(4, 7).map((i, j) => j === 2 ? { ...i, transform: [7, 0, 0, 7, 82, 54] } : i);
  assert.deepEqual((await recoverMathScripts(page, { items: gap })).items, gap);
});

test('an acronym keeps an attached, lowered name qualifier while separate capitalized words stay independent', async () => {
  const { recoverMathScripts } = await import('../src/pdfLayout.mjs');
  const glyph = (str, x, y, height, fontName = 'roman') => ({ str, width: 20, height, fontName, transform: [height, 0, 0, height, x, y] });
  const name = glyph('Of the two XYZ', 10, 50, 10);
  const qualified = glyph('SMALL', 30.2, 48.5, 7);
  const page = { getOperatorList: async () => {}, commonObjs: new Map() };
  assert.equal((await recoverMathScripts(page, { items: [name, qualified] })).items[0].str, 'Of the two XYZ_{SMALL}');
  for (const pair of [[name, glyph('SMALL', 35, 48.5, 7)], [name, glyph('SMALL', 30, 50, 7)],
    [name, glyph('SMALL', 30, 48.5, 10)], [name, glyph('SMALL', 30, 48.5, 7, 'bold')],
    [glyph('prose text', 10, 50, 10), qualified], [name, glyph('ABC', 30, 41, 7)]]) {
    assert.deepEqual((await recoverMathScripts(page, { items: pair })).items, pair);
  }
});

test('only an isolated full-width opening figure lets a body paragraph resume past its caption', async () => {
  const { openingFigure } = await import('../src/pdfLayout.mjs');
  const { stitchPageBlocks } = await import('../src/pdfDecorations.mjs');
  const line = (text, lane, x, y) => ({ text, lane, x, y, width: 240, height: 10 });
  const diagram = line('Training', 'left', 50, 730);
  const caption = line('Figure 1: Comparison of objec-', 'spanning', 50, 660);
  const tail = line('tives.', 'left', 50, 648);
  const body = [line('ing and encoding across several methods.', 'left', 50, 620),
    line('Models can be compared across measures.', 'right', 330, 620)];
  const opening = openingFigure([diagram, caption, tail, ...body], 800);
  assert.deepEqual(opening.body, body);
  assert.equal(opening.figure.at(-1).text, 'Figure 1: Comparison of objectives.');
  const blocks = stitchPageBlocks([{ id: 1, page: 2, text: 'Left-to-right language model-' },
    ...opening.figure.map((row, i) => ({ id: i + 2, page: 3, text: row.text })),
    { id: 4, page: 3, text: body[0].text }], { floatingIDs: new Set([2, 3]) });
  assert.deepEqual(blocks.map(b => b.text), ['Left-to-right language modeling and encoding across several methods.',
    diagram.text, opening.figure.at(-1).text]);
  assert.equal(blocks[0].endPage, 3);
  assert.equal(openingFigure([{ ...diagram, text: 'Previous body paragraph at normal size' }, caption, tail, ...body], 800), null);
  assert.equal(openingFigure([diagram, caption, tail, body[0]], 800), null);
  assert.equal(openingFigure([diagram, { ...caption, lane: 'left' }, tail, ...body], 800), null);
});

test('a wrapped numeric citation stays separated from the preceding prose word', async () => {
  const { joinPdfText } = await import('../src/text.mjs');
  assert.equal(joinPdfText('Table 13 compares results. Following', '[41], we first test'), 'Table 13 compares results. Following [41], we first test');
  assert.equal(joinPdfText('The earlier measurements in', '[12, 14–16] show why'), 'The earlier measurements in [12, 14–16] show why');
  assert.equal(joinPdfText('values', '[41]'), 'values[41]');
  assert.equal(joinPdfText('table.cells', '[12].value'), 'table.cells[12].value');
});

test('a numeric table in the right column stays separate from a split word underneath it', async () => {
  const { bodyAfterColumnTable } = await import('../src/pdfLayout.mjs');
  const { stitchPageBlocks } = await import('../src/pdfDecorations.mjs');
  const line = (text, x, y, height = 9) => ({ text, x, y, height, lane: 'right' });
  const rows = [line('method val test', 330, 720), line('Model A 12.3 14.5', 325, 708),
    line('Model B 10.1 13.6', 325, 697), line('Table 14. Performance', 310, 680),
    line('on a held-out dataset.', 310, 669), line('ports the observed error across tasks.', 310, 645, 10)];
  assert.equal(bodyAfterColumnTable(rows), 5);
  const secondTable = rows.map(row => ({ ...row, y: row.y - 100 }));
  secondTable[0] = { ...secondTable[0], height: 8 };
  assert.equal(bodyAfterColumnTable([...rows.slice(0, 5), ...secondTable]), 10);
  const interveningProse = { ...rows.at(-1), text: 'A separate paragraph ends here.' };
  assert.equal(bodyAfterColumnTable([...rows.slice(0, 5), interveningProse, ...secondTable]), 0);
  assert.equal(bodyAfterColumnTable([{ ...rows[0], text: 'Some ordinary paragraphs also mention tables.' }, ...rows.slice(1)]), 0);
  assert.equal(bodyAfterColumnTable([...rows.slice(0, -1), { ...rows.at(-1), y: 659 }]), 0);
  const blocks = [{ id: 1, page: 12, text: 'Table 13 compares the results. The publication re-' },
    { id: 2, page: 12, text: 'Model A 12.3 14.5' }, { id: 3, page: 12, text: 'Table 14. Performance on a held-out dataset.' },
    { id: 4, page: 12, text: rows.at(-1).text }];
  const positions = { floatingIDs: new Set([2, 3]), columnStarts: new Set([4]) };
  const stitched = stitchPageBlocks(blocks, positions);
  assert.equal(stitched[0].text, 'Table 13 compares the results. The publication reports the observed error across tasks.');
  assert.deepEqual(stitched.slice(1).map(b => b.text), blocks.slice(1, 3).map(b => b.text));
  assert.equal(stitchPageBlocks([{ ...blocks[0], text: 'Table 13. Measurements of the re-' }, ...blocks.slice(1)], positions).length, 4);
});

test('only hyphenated prose can continue from the bottom of a column to the top of the next', async () => {
  const { stitchPageBlocks } = await import('../src/pdfDecorations.mjs');
  const blocks = [{ id: 1, page: 3, text: 'There is mini-' }, { id: 2, page: 3, text: 'mal difference between the models.' }];
  const turn = { columnStarts: new Set([2]) };
  assert.equal(stitchPageBlocks(blocks, turn)[0].text, 'There is minimal difference between the models.');
  assert.equal(stitchPageBlocks(blocks).length, 2);
  assert.equal(stitchPageBlocks([{ ...blocks[0], text: 'There is a difference.' }, blocks[1]], turn).length, 2);
  assert.equal(stitchPageBlocks([blocks[0], { ...blocks[1], heading: true }], turn).length, 2);
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

test('margin filtering retains a sparse page’s numbered observations and still removes genuine running matter', async () => {
  const { filterRepeatedPageDecorations } = await import('../src/pdfDecorations.mjs');
  const line = (text, y) => ({ text, y, height: 12 });
  const pages = [1, 2, 3].map(n => ({ height: 800, lines: [
    line('Observations in 2026', 770), line('Observation ' + n + ' recorded a voltage of 1.25 V.', 710), line('Page ' + n + ' of 3', 30)
  ] }));
  assert.deepEqual(filterRepeatedPageDecorations(pages).map(p => p.lines.map(l => l.text)), [
    ['Observations in 2026', 'Observation 1 recorded a voltage of 1.25 V.'],
    ['Observation 2 recorded a voltage of 1.25 V.'], ['Observation 3 recorded a voltage of 1.25 V.']
  ]);
  const onlyFolio = pages.map((page, index) => ({ ...page, lines: [line('Page ' + (index + 1), 30)] }));
  assert.ok(filterRepeatedPageDecorations(onlyFolio).every(page => !page.lines.length));
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
