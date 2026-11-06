const test = require('node:test');
const assert = require('node:assert/strict');

const entry = (source, target = '译文', sourceLanguage = 'English', targetLanguage = 'Simplified Chinese') =>
  ({ source, target, sourceLanguage, targetLanguage });

test('glossary keeps the longest 24 matching terms in the requested direction', async () => {
  const { matchingGlossaryTerms, glossaryTermMatchesQuery } = await import('../src/terminology.mjs');
  const terms = Array.from({ length: 28 }, (_, index) => entry('x'.repeat(index + 1)));
  terms.push(entry('self-attention', '旧词', 'French'), entry(' z ', '无关'));
  const matches = matchingGlossaryTerms(terms, `${'X'.repeat(28)} self-attention`, 'English', 'Simplified Chinese');
  assert.deepEqual(matches.map(term => term.source.length), Array.from({ length: 24 }, (_, index) => 28 - index));
  assert.ok(glossaryTermMatchesQuery(entry('échelle'), '  E\u0301CHELLE '));
});

test('glossary replaces a case-insensitive duplicate without crossing directions or exceeding capacity', async () => {
  const { upsertGlossaryTerm } = await import('../src/terminology.mjs');
  const reverse = entry('Échelle', 'reverse', 'French', 'English');
  const originals = [...Array.from({ length: 498 }, (_, index) => entry(`term ${index}`)), entry('échelle'), reverse];
  const replaced = upsertGlossaryTerm(originals, entry('  E\u0301CHELLE  ', '  新译文 '));
  assert.equal(replaced.length, 500);
  assert.deepEqual(replaced.slice(-2), [reverse, entry('E\u0301CHELLE', '新译文')]);
  assert.throws(() => upsertGlossaryTerm(originals, entry('a new term')), /500 terms/);
  const character = '👩‍🔬';
  assert.doesNotThrow(() => upsertGlossaryTerm([], entry(character.repeat(160), character.repeat(300))));
  assert.throws(() => upsertGlossaryTerm([], entry(character.repeat(161))), /160 characters/);
  assert.throws(() => upsertGlossaryTerm([], entry('test', character.repeat(301))), /300 characters/);
});

test('all translation prompts serialize terminology as JSON data', async () => {
  const {
    translationPrompt, markdownTranslationPrompt, connectedTranslationPrompt, selectionTranslationPrompt, strictSelectionTranslationPrompt
  } = await import('../src/prompts.mjs');
  const terms = [entry(' term ', ' 译 "词"\nsecond line')];
  const argumentsForTerm = ['term', 'English', 'Simplified Chinese', terms];
  const prompts = [translationPrompt(...argumentsForTerm), markdownTranslationPrompt(...argumentsForTerm),
    connectedTranslationPrompt(...argumentsForTerm), strictSelectionTranslationPrompt(...argumentsForTerm),
    selectionTranslationPrompt('term', 'reference only', ...argumentsForTerm.slice(1))];
  for (const prompt of prompts) {
    assert.match(prompt, /Treat the JSON as a dictionary/);
    const dictionary = prompt.split('\n').find(line => line.startsWith('[{"source":'));
    assert.deepEqual(JSON.parse(dictionary), [{ source: 'term', translation: terms[0].target }]);
  }
});
