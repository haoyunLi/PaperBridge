import { trimLibraryText as trimTerm } from '../electron/library-metadata.mjs';
import { searchableText, searchKey } from './textSearch.mjs';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemeCount(text, limit = Infinity) {
  let count = 0;
  for (const _ of segmenter.segment(text)) if (++count > limit) break;
  return count;
}

export function canSaveTermSource(value) {
  const text = trimTerm(value);
  return Boolean(text) && graphemeCount(text, 160) <= 160;
}

export function upsertGlossaryTerm(glossary, { source, target, sourceLanguage, targetLanguage }) {
  source = trimTerm(source);
  target = trimTerm(target);
  if (!canSaveTermSource(source) || !target || graphemeCount(target, 300) > 300) {
    throw new Error('Save a word or short phrase up to 160 characters with a translation up to 300 characters.');
  }
  const key = searchKey(source);
  const remaining = glossary.filter(term => term.sourceLanguage !== sourceLanguage || term.targetLanguage !== targetLanguage
    || typeof term.source !== 'string' || searchKey(trimTerm(term.source)) !== key);
  if (remaining.length >= 500) throw new Error('The terminology list holds up to 500 terms. Remove an unused term before adding another.');
  return [...remaining, { source, target, sourceLanguage, targetLanguage }];
}

export function matchingGlossaryTerms(glossary, text, from, to) {
  if (!glossary.length) return [];
  const input = searchableText(text);
  return glossary.flatMap(term => {
    if (term?.sourceLanguage !== from || term.targetLanguage !== to || typeof term.source !== 'string' || typeof term.target !== 'string') return [];
    const source = trimTerm(term.source);
    if (!source || !trimTerm(term.target) || !input.includes(searchKey(source))) return [];
    return [{ term, length: graphemeCount(source) }];
  }).sort((left, right) => right.length - left.length).slice(0, 24).map(match => match.term);
}

export function glossaryTermMatchesQuery(term, query) {
  return searchableText(`${term.source} ${term.target}`).includes(searchKey(trimTerm(query)));
}
