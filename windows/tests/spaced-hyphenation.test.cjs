const test = require('node:test');
const assert = require('node:assert/strict');
const helper = import('../src/spacedHyphenation.mjs');

test('spaced PDF fragments follow the Mac repairs and preserve its compound suffixes', async () => {
  const { repairSpacedHyphenation: repair, compoundSuffixes } = await helper;
  assert.equal(repair('The natu- ral mea- sure lets our model out- perform the baseline and supports re- search.'),
    'The natural measure lets our model outperform the baseline and supports research.');
  assert.equal(repair('We compare a well- known model- based method with T- cell data and end- to-end training.'),
    'We compare a well-known model-based method with T-cell data and end-to-end training.');
  for (const suffix of compoundSuffixes) assert.equal(repair(`model- ${suffix}`), `model-${suffix}`);
  assert.equal(repair('state-of-the- art and attention- based inference'), 'state-of-the-art and attention-based inference');
});

test('the Mac repair is a bounded ASCII heuristic rather than a formula or word dictionary', async () => {
  const { repairSpacedHyphenation: repair } = await helper;
  assert.equal(repair('x- axis; x - axis; x− axis; x‐ axis; x- a; re- Search'),
    'xaxis; x - axis; x− axis; x‐ axis; x- a; re- Search');
  assert.equal(repair('a'.repeat(30) + '- bc'), 'a'.repeat(30) + 'bc');
  assert.equal(repair('a'.repeat(31) + '- bc'), 'a'.repeat(31) + '- bc');
  assert.equal(repair('ab- ' + 'c'.repeat(31)), 'ab' + 'c'.repeat(31));
  assert.equal(repair('ab- ' + 'c'.repeat(32)), 'ab- ' + 'c'.repeat(32));
  assert.equal(repair('ab- c; 3D- based; pre_re- sults; re- sults2; re- sults_'),
    'ab- c; 3D- based; pre_re- sults; re- sults2; re- sults_');
  assert.equal(repair('(re- sults), ab- cd²'), '(results), abcd²');
});

test('ICU boundaries protect Unicode words, marks and format characters without rejecting valid starts', async () => {
  const { repairSpacedHyphenation: repair } = await helper;
  for (const prefix of ['é', '汉', '𝒙', '_', '\u0301é', 'é\u0301', 'a\u200d']) {
    const input = `${prefix}ab- cd`;
    assert.equal(repair(input), input);
  }
  for (const suffix of ['é', '汉', '𝒙', '\u0301', '\u200c', '\u200d', '\u2060', '_', '2']) {
    const input = `ab- cd${suffix}`;
    assert.equal(repair(input), input);
  }
  for (const prefix of ['\u0301', '\u200c', '\u200d', '\u2060', '😀', ' ']) {
    assert.equal(repair(`${prefix}ab- cd`), `${prefix}abcd`);
  }
  assert.equal(repair('éab-cd- ef'), 'éab-cdef', 'a rejected outer candidate must not hide a valid inner start');
});

test('ICU whitespace and nonoverlapping one-pass replacement remain distinct from JavaScript defaults', async () => {
  const { repairSpacedHyphenation: repair } = await helper;
  for (const separator of [' ', '\t', '\n', '\r\n', '\u000b', '\u0085', '\u00a0', '\u2028', '\u2029']) {
    assert.equal(repair(`re-${separator}sults`), 'results');
  }
  assert.equal(repair('re-\ufeffsults'), 're-\ufeffsults');
  let chain = 'aa- bb- cc- dd- ee';
  chain = repair(chain);
  assert.equal(chain, 'aabb- ccdd- ee');
  chain = repair(chain);
  assert.equal(chain, 'aabbccdd- ee');
  chain = repair(chain);
  assert.equal(chain, 'aabbccddee');
  assert.equal(repair(''), '');
});
