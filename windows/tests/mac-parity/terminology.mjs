import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../../electron/storage.cjs';
import { matchingGlossaryTerms, upsertGlossaryTerm } from '../../src/terminology.mjs';

export function verifyTerminology(reference, root) {
  const fixture = JSON.parse(readFileSync(new URL('./terminology.json', import.meta.url), 'utf8'));
  const store = createStore(root);
  let terms = store.glossary();
  function save(source, target, reverse = false) {
    let next;
    try {
      next = upsertGlossaryTerm(terms, { source, target, sourceLanguage: reverse ? 'zh' : 'en', targetLanguage: reverse ? 'en' : 'zh' });
    } catch {
      return false;
    }
    store.saveGlossary(next);
    terms = next;
    return true;
  }
  function pairs(text, reverse = false) {
    return matchingGlossaryTerms(terms, text, reverse ? 'zh' : 'en', reverse ? 'en' : 'zh')
      .map(term => ({ source: term.source, translation: term.target }));
  }
  function reopened() {
    return createStore(root).glossary().map(term => ({ source: term.source, target: term.target, reverse: term.sourceLanguage === 'zh' }));
  }
  assert.deepEqual(fixture.saves.map(item => save(item.source, item.target, item.reverse)), reference.accepted, 'Glossary save/replace/empty input');
  assert.deepEqual(reopened(), reference.reopened, 'Glossary contents after reopening');
  fixture.queries.forEach((query, index) => assert.deepEqual(pairs(query.text, query.reverse), reference.queries[index], query.text));
  terms = terms.filter(term => !(term.source === '磁场' && term.sourceLanguage === 'zh'));
  store.saveGlossary(terms);
  assert.deepEqual(reopened(), reference.afterRemoval, 'Only the chosen reverse term was removed');
  const symbol = '👩🏽‍🔬';
  assert.deepEqual([save(symbol.repeat(160), 'ok'), save(symbol.repeat(161), 'ok'),
    save('length', symbol.repeat(300)), save('length', symbol.repeat(301))], reference.boundaries, 'Source and target grapheme limits');
  const termAt = index => 'term-' + String(index).padStart(3, '0');
  terms = Array.from({ length: 500 }, (_, index) => ({
    source: termAt(index + 1), target: 'T' + (index + 1), sourceLanguage: 'en', targetLanguage: 'zh'
  }));
  assert.deepEqual([save('extra', 'extra'), save('TERM-009', 'replacement')], reference.capacity, 'At capacity, replacement still succeeds');
  assert.equal(reopened().length, reference.countAtCapacity);
  const query = Array.from({ length: 27 }, (_, index) => termAt(index + 1)).join(' ');
  assert.deepEqual(pairs(query), reference.capped, 'At most 24 matching terms reach the translation prompt in native order');
  console.log('Checked ' + fixture.saves.length + ' terminology saves, ' + fixture.queries.length + ' prompt queries, deletion, reopening and capacity against native macOS.');
}
