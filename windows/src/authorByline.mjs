import { matchingGlossaryTerms } from './terminology.mjs';
import { promptStyleGuide } from '../electron/translation-style.mjs';

// A numbered byline precedes its affiliation key in a paper's front matter.
const bodyHeading = /^(?:#{1,6}\s*)?(?:\d+[.)]?\s*)?(?:abstract|summary|introduction|methods?|results|references|摘要|引言|方法|结果|参考文献)\s*[:.]?$/iu;
const affiliation = /^\[?(\d{1,3})\]?[.)]?\s+.{0,140}?(?<!\p{L})(?:university|universität|université|universidad|institute|institut|department|division|laboratory|school|faculty|centre|center|college|observatory|academy)(?!\p{L})/iu;
const nameWord = /^(?:\p{Lu}[\p{L}\p{M}'’‐-]*|(?:\p{Lu}\.)+|de|da|dos|del|der|di|du|la|le|van|von|y)$/u;
const numberedName = /^(.+?)\s*(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)[*†‡]?$/u;

function hasNumberedNames(text, firstAffiliation) {
  const authors = text.split(/\s*(?:[,;]\s*(?:and\s+)?|\s+and\s+|\s+&\s+)(?=\p{Lu})/u);
  if (authors.length < 2) return false;
  let citesFirst = false;
  for (const author of authors) {
    const match = numberedName.exec(author);
    if (!match) return false;
    const words = match[1].trim().split(/\s+/);
    if (words.length < 2 || words.length > 7 || !words.every(word => nameWord.test(word))) return false;
    if (match[2].match(/\d+/g).includes(firstAffiliation)) citesFirst = true;
  }
  return citesFirst;
}

export function findNumberedAuthorBlock(blocks, settings = {}, glossary = []) {
  if (promptStyleGuide(settings.translationStyleGuide)) return null;
  for (let i = 0; i < Math.min(blocks.length - 1, 12); i++) {
    const block = blocks[i];
    const text = String(block.text || '').trim();
    if (block.page > 1 || bodyHeading.test(text)) break;
    if (!i || !text || text.length > 1600 || block.resource) continue;
    const first = affiliation.exec(String(blocks[i + 1].text || '').trim().normalize('NFKC'));
    if (first && hasNumberedNames(text.normalize('NFKC'), first[1])) {
      const customNames = matchingGlossaryTerms(glossary, text, settings.sourceLanguage, settings.targetLanguage);
      return customNames.length ? null : block;
    }
  }
  return null;
}
