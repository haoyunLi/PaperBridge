const test = require('node:test');
const assert = require('node:assert/strict');

test('diagram extraction omits only uniquely identified runs entirely outside the enclosing form', async () => {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { omitClippedFigureText } = await import('../src/pdfFigureText.mjs');
  const mark = (str, y) => ({ str, fontName: 'chart', transform: [10, 0, 0, 10, 30, y], width: 32, height: 10 });
  const clipped = mark('Cropped above plot', 150), partial = mark('Touches edge', 109), duplicate = mark('Drawn twice', 150);
  const displaced = mark('Other coordinates', 80), following = mark('Printed heading', 162);
  const axis = { ...mark('Axis', 45), transform: [0, 10, -10, 0, 25, 45] };
  const list = { fnArray: [], argsArray: [] };
  function op(fn, ...args) { list.fnArray.push(OPS[fn]); list.argsArray.push(args); }
  function draw(label, y) {
    op('beginText'); op('setFont', 'chart', 10); op('setTextMatrix', [1, 0, 0, 1, 10, y]);
    op('showText', [...label].map(unicode => ({ unicode }))); op('endText');
  }
  op('save'); op('transform', 1, 0, 0, 1, 20, 30);
  op('paintFormXObjectBegin', [1, 0, 0, 1, 0, 0], [0, 0, 100, 70]);
  op('beginGroup', { matrix: null }); op('paintFormXObjectBegin', null, null);
  draw(clipped.str, 120); draw(partial.str, 79); draw(duplicate.str, 120); draw(displaced.str, 120);
  op('paintFormXObjectEnd'); op('endGroup'); op('paintFormXObjectEnd');
  draw(duplicate.str, 120); draw(following.str, 132); op('restore');
  const font = { bbox: [-100, -300, 1100, 1010], fontMatrix: [0.001, 0, 0, 0.001, 0, 0] };
  const page = { getOperatorList: async () => list, commonObjs: new Map([['chart', font]]) };
  const content = { items: [axis, following, clipped, partial, duplicate, displaced] };
  assert.deepEqual((await omitClippedFigureText(page, content, OPS)).items, [axis, following, partial, duplicate, displaced]);
  list.fnArray.pop(); list.argsArray.pop();
  assert.equal(await omitClippedFigureText(page, content, OPS), content, 'An unbalanced drawing list preserves the original layer');
  const prose = { items: [following] };
  assert.equal(await omitClippedFigureText({ getOperatorList() { assert.fail('unnecessary image decoding'); } }, prose, OPS), prose);
});

test('right-aligned rotated figure labels remain in physical order in both orientations and survive repeated page margins', async () => {
  const { pageLines } = await import('../src/pdfLayout.mjs');
  const { filterRepeatedPageDecorations } = await import('../src/pdfDecorations.mjs');
  const rotated = (str, x, y, width, direction) => ({ str, fontName: 'axis', height: 10, width,
    transform: [0, 10 * direction, -10 * direction, 0, x, y - direction * width] });
  const labels = (y, d) => ['The', 'Law', 'will', 'never'].map((s, i) => rotated(s, 50 + i * 15, y, [18, 12, 14, 28][i], d));
  const lines = pageLines({ items: [...labels(700, 1), ...labels(62, -1)] }, [0, 0, 600, 800]);
  assert.deepEqual(lines.map(line => [line.text, line.figureAxis]), Array(2).fill(['The Law will never', true]));
  const page = n => ({ height: 800, lines: [...lines, { text: 'Figure ' + n + ': Layer weights', x: 20, y: 48, height: 10 },
    { text: 'Publisher footer', x: 20, y: 12, height: 10 }] });
  for (const result of filterRepeatedPageDecorations([page(1), page(2)])) {
    assert.deepEqual(result.lines.slice(0, 2), lines);
    assert.equal(result.lines.length, 3);
    assert.match(result.lines[2].text, /^Figure [12]:/);
  }
});
