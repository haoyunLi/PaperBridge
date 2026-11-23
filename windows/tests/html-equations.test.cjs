const test = require('node:test');
const assert = require('node:assert/strict');

async function rendered(source) {
  const { unified } = await import('unified');
  const { default: parse } = await import('remark-parse');
  const { default: asHTML } = await import('remark-rehype');
  const { markdownPlugins, rehypePlugins } = await import('../src/markdownRendering.mjs');
  const processor = unified().use(parse).use(markdownPlugins)
    .use(asHTML, { allowDangerousHtml: true }).use(rehypePlugins);
  const tree = processor.runSync(processor.parse(source), source);
  const formulas = [], plain = [];
  function visit(node) {
    if (node.tagName === 'annotation') formulas.push(node.children[0].value);
    if (node.type === 'text') plain.push(node.value);
    for (const child of node.children || []) visit(child);
  }
  visit(tree);
  return { formulas, text: plain.join('') };
}

test('printed prices and escaped dollars leave subsequent HTML caption math available', async () => {
  const result = await rendered('<figure><figcaption>Price \\$4, range $5–$10. Estimate \\(n+1\\), gain $g^2$.</figcaption></figure>');
  assert.deepEqual(result.formulas, ['n+1', 'g^2']);
  assert.ok(result.text.includes('Price $4, range $5–$10.'));
});

test('Markdown TeX preserves emphasis characters, quoted line breaks and code literals', async () => {
  const source = '> \\[\r\n> A=\\frac{1}{2}\r\n> \\]\r\n\r\n' +
    'See [\\(x_1*x_2\\)](https://example.org) and `\\(sample\\)`.';
  const result = await rendered(source);
  assert.deepEqual(result.formulas, ['A=\\frac{1}{2}', 'x_1*x_2']);
  assert.ok(result.text.includes('\\(sample\\)'));
  const { parseMarkdown } = await import('../src/markdownRendering.mjs');
  const link = parseMarkdown(source).children.at(-1).children.find(item => item.type === 'link');
  assert.equal(link.url, 'https://example.org');
  assert.equal(source.slice(link.children[0].position.start.offset, link.children[0].position.end.offset), '\\(x_1*x_2\\)');
});

test('unmatched and double-escaped openers do not consume a later valid equation', async () => {
  const result = await rendered('Print \\\\(plain\\\\) and \\(unpaired, then \\(x^2\\).');
  assert.deepEqual(result.formulas, ['x^2']);
  assert.ok(result.text.includes('\\(plain\\) and (unpaired'));
});

test('raw tables support nested formatting and TeX groups while preserving code examples', async () => {
  const result = await rendered('<table><tr><td><b>$$\\text{cost \\$5}$$</b></td><td><code>\\(y\\)</code></td></tr></table>');
  assert.deepEqual(result.formulas, ['\\text{cost \\$5}']);
  assert.ok(result.text.includes('\\(y\\)'));
});

test('GFM cells retain normal Markdown escapes and inline math parsing', async () => {
  const result = await rendered('| Printed | Measured |\n| --- | --- |\n| \\$x\\$ | $y$ |');
  assert.deepEqual(result.formulas, ['y']);
  assert.ok(result.text.includes('$x$'));
});
