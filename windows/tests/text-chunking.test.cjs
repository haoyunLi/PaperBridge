const test = require('node:test');
const assert = require('node:assert/strict');
const textHelpers = import('../src/text.mjs');
const promptHelpers = import('../src/prompts.mjs');
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const length = text => [...graphemes.segment(text)].length;
const compact = text => text.replace(/\p{White_Space}+/gu, '');

test('a protected formula at the real 500-character setting survives an unchanged model round trip', async () => {
  const { chunkText } = await textHelpers;
  const { protectMarkdown, restoreMarkdown } = await promptHelpers;
  const source = 'word '.repeat(98) + '$E=mc^2$ and ![figure](figures/result.png) ' +
    'evidence '.repeat(64) + 'https://example.org/paper?q=1 and `code()`.';
  const protectedText = protectMarkdown(source);
  const chunks = chunkText(protectedText.text, 500);
  assert.ok(chunks.length > 1);
  for (const [token] of protectedText.tokens) assert.equal(chunks.filter(chunk => chunk.includes(token)).length, 1);
  assert.ok(chunks.every(chunk => length(chunk) <= 500));
  const restored = restoreMarkdown(chunks.join('\n'), protectedText.tokens);
  assert.equal(compact(restored), compact(source), 'Chunking must not blame an unchanged model for a token split by the app');
});

test('long paragraphs preserve repeated punctuation, decimal numbers, quotes and CJK sentence endings', async () => {
  const { chunkText } = await textHelpers;
  const source = '... “Attention matters!!!” Values are 3.14159, e.g. 2.71828; why?! ' +
    '证据明确……保留中文标点！？'.repeat(8) + ' Final result...';
  const chunks = chunkText(source, 30);
  assert.equal(compact(chunks.join('')), compact(source));
  assert.ok(chunks.every(chunk => length(chunk) <= 30));
  assert.ok(chunks.join(' ').includes('Attention matters!!!'));
  assert.ok(chunks.join(' ').endsWith('Final result...'));
});

test('chunk limits count full Unicode graphemes and never split surrogate pairs or combining sequences', async () => {
  const { chunkText } = await textHelpers;
  const source = 'word '.repeat(99) + 'abcd🧬 ' + 'more '.repeat(25);
  const chunks = chunkText(source, 500);
  assert.ok(chunks.every(chunk => chunk.isWellFormed()));
  assert.equal(compact(chunks.join('')), compact(source));
  assert.ok(chunks[0].endsWith('abcd🧬'), 'A 500-grapheme chunk may exceed 500 UTF-16 code units');
  const units = ['e\u0301', '👩🏽‍🔬', '🇨🇦', '𝛼'];
  const word = units.join('').repeat(3);
  const split = chunkText(word, 3);
  assert.deepEqual(split, Array.from({ length: 4 }, (_, index) => Array.from({ length: 3 }, (_, at) => units[(index * 3 + at) % units.length]).join('')));
  assert.ok(split.every(chunk => chunk.isWellFormed() && length(chunk) === 3));
});

test('sentence and clause boundaries precede word packing, while ordinary words stay whole', async () => {
  const { chunkText } = await textHelpers;
  assert.deepEqual(chunkText('First sentence. Second sentence. Third sentence.', 20), ['First sentence.', 'Second sentence.', 'Third sentence.']);
  assert.deepEqual(chunkText('Alpha beta; Gamma delta, Epsilon zeta.', 30), ['Alpha beta;', 'Gamma delta, Epsilon zeta.']);
  assert.deepEqual(chunkText('alpha beta gamma delta epsilon', 12), ['alpha beta', 'gamma delta', 'epsilon']);
  const words = chunkText('evidence '.repeat(70), 500);
  assert.ok(words.every(chunk => chunk.split(' ').every(word => word === 'evidence')));
  assert.deepEqual(chunkText('abcdefghijklmno', 5), ['abcde', 'fghij', 'klmno']);
});

test('protected tokens remain atomic even beside prose or when larger than the requested limit', async () => {
  const { chunkText } = await textHelpers;
  const token = '__PAPERBRIDGE_TOKEN_0123__';
  const source = `before${token}after`;
  const chunks = chunkText(source, 10);
  assert.equal(chunks.filter(chunk => chunk.includes(token)).length, 1);
  assert.equal(chunks.join(''), source);
  assert.deepEqual(chunks.filter(chunk => length(chunk) > 10), [token], 'Only the indivisible token may exceed the limit');
  const repeated = chunkText(`${token}${token}`, 10);
  assert.deepEqual(repeated, [token, token]);
});

test('empty and short input follows Mac trimming, and invalid bounds cannot loop indefinitely', async () => {
  const { chunkText } = await textHelpers;
  assert.deepEqual(chunkText(' \n\t '), []);
  assert.deepEqual(chunkText('  First line.\nSecond line.  '), ['First line.\nSecond line.']);
  for (const limit of [0, -1, Infinity, NaN]) assert.throws(() => chunkText('Long paragraph.', limit), RangeError);
});

test('chunk whitespace preserves FEFF and treats NEL as whitespace like the Mac pipeline', async () => {
  const { chunkText } = await textHelpers;
  assert.deepEqual(chunkText('\uFEFFAlpha\uFEFF', 500), ['\uFEFFAlpha\uFEFF']);
  assert.deepEqual(chunkText('\u0085Alpha\u0085', 500), ['Alpha']);
  assert.deepEqual(chunkText('\u0085', 500), []);
  assert.deepEqual(chunkText('Alpha\u0085Beta\u0085Gamma', 10), ['Alpha Beta', 'Gamma']);
  assert.deepEqual(chunkText('Alpha;\u0085Beta gamma delta', 14), ['Alpha;', 'Beta gamma', 'delta']);
  assert.deepEqual(chunkText('Alpha\uFEFFBeta Gamma', 10), ['Alpha\uFEFFBeta', 'Gamma']);
  const long = '\uFEFF' + 'x'.repeat(501) + '\uFEFF';
  const chunks = chunkText(long, 500);
  assert.equal(chunks.join(''), long, 'FEFF at an input or newly split chunk edge is retained exactly');
  assert.ok(chunks.every(chunk => length(chunk) <= 500));
});
