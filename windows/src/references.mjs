import { detectedSectionTitle } from './sectionHeadings.mjs';

const referenceHeading = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:references|bibliography|works cited|literature cited|reference list)(?=[\s:.：]|$)[\s:.：]*/i;
const postReferenceHeading = /^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:(?:star[+\s-]*methods|resource availability|method details|experimental model and subject details|key resources table|quantification and statistical analysis|supplemental information|supplementary (?:information|materials?|figures?)|appendix)(?=[\s:.：]|$)|(?:methods?|materials and methods)[:：])/i;
// Some imports retain a physical heading and its first body line in one block.
const methodsHeading = /^(?:\d+(?:\.\d+)*[.)]?\s*)?[\p{P}\s]*(?:methods?|materials and methods)[\p{P}\s]*$/iu;
export function isMethodsHeading(line) {
  return methodsHeading.test(line);
}

function startsPostReferenceSection(text) {
  if (postReferenceHeading.test(text) || isMethodsHeading(text.split(/[\r\n]/, 1)[0])) return true;
  // Older pasted papers flattened the title and body. Reuse the Reader's
  // inline heading detection and leave the saved text and offsets intact.
  return /^(?:\d+(?:\.\d+)*\s+)?(?:methods?|materials and methods)\s/i.test(text)
    && isMethodsHeading(detectedSectionTitle(text) || '');
}

const citationNumber = /^(?:\[\d+\]|\d+[.)]\s+)\s*/;
const initialsFirst = /^(?:\p{Lu}\.\s*)+\p{Lu}[\p{L}'’-]+/u;
const surnameFirst = /^\p{Lu}[\p{L}'’.-]+,\s*(?:\p{Lu}\.|(?:\p{Lu}[\p{L}'’-]+\s*)?\((?:19|20)\d{2})/u;
const fullName = /^\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]*)+[.,:]/u;
const authorAndYear = /^\p{Lu}[\p{L}'’.-]+(?:(?:,|\s+(?:and|&))?\s+\p{Lu}[\p{L}'’.-]+)*(?:\s+et al\.)?\s+(?:\((?:19|20)\d{2}[a-z]?\)[.,]|(?:19|20)\d{2}[a-z]?[.,])/u;
const bibliographicDate = /[.。]\s*\((?:19|20)\d{2}[a-z]?\)\s*[.。]/i;
const terminalDOI = /(?:^|\s)(?:(?:https?:\/\/(?:dx\.)?doi\.org\/)|(?:doi:\s*))?10\.\d{4,9}\/\S+\s*$/i;
const caption = /^(?:figure|fig\.|table)\s+\d+[.:]/i;

function isReferenceEntry(text) {
  if (text.length < 20 || text.length > 1200) return false;
  const number = citationNumber.exec(text);
  const authorText = number ? text.slice(number[0].length) : text;
  const author = initialsFirst.test(authorText) || surnameFirst.test(authorText) || fullName.test(authorText) || authorAndYear.test(authorText);
  const year = /\b(?:19|20)\d{2}[a-z]?\b/i.test(text);
  const venue = /\b(?:journal|proceedings|arxiv|conference|vol\.|pp\.)/i.test(text);
  const identifier = /\b10\.\d{4,9}\/\S+|\bdoi\s*:/i.test(text);
  return (author && (Boolean(number) || year || venue || identifier))
    || (Boolean(number) && (identifier || year && venue))
    || (identifier && bibliographicDate.test(authorText) && terminalDOI.test(authorText));
}

function continuesSplitCitation(text, next) {
  if (!next || !initialsFirst.test(text) || !/^\p{Ll}/u.test(next.text)) return false;
  const secondAuthor = text.split(/,\s*/, 2)[1];
  // A short author list can look like a heading. Use the continued title,
  // publication year and next numbered citation as evidence across the break.
  return Boolean(secondAuthor && initialsFirst.test(secondAuthor)
    && /\b(?:19|20)\d{2}[a-z]?\b/i.test(next.text)
    && /\[\d+\]\s+(?:\p{Lu}\.\s*)+\p{Lu}[\p{L}'’-]+/u.test(next.text));
}

function sectionEnd(entries, start) {
  let sawEntry = entries[start].entry || entries[start].inline;
  for (let i = start + 1; i < entries.length; i++) {
    const { text, heading, entry, explicit, index } = entries[i];
    if (explicit || !entry && startsPostReferenceSection(text)) return i;
    if (!entry && sawEntry && !entries.slice(i + 1, i + 4).some(item => item.entry)) {
      // PDF extraction can leave a figure caption or its label immediately after the last citation.
      const next = entries[i + 1];
      if (heading && !continuesSplitCitation(text, next)) return i;
      if (caption.test(text) || next?.index > index + 1 && caption.test(next.text)) return i;
    }
    sawEntry ||= entry;
  }
  return entries.length;
}

function implicitStart(entries) {
  for (let i = Math.max(3, Math.floor(entries.length * 0.6)); i <= entries.length - 3; i++) {
    if (!entries[i].entry) continue;
    let start = i;
    while (start > 0 && entries[start - 1].entry) start--;
    const window = entries.slice(start, start + 6);
    const nextSection = window.findIndex(item => !item.entry && startsPostReferenceSection(item.text));
    const candidates = nextSection < 0 ? window : window.slice(0, nextSection);
    const count = candidates.filter(item => item.entry).length;
    if (count >= 3 && count / candidates.length >= 0.6) return start;
  }
  return -1;
}

export function referenceBlockIds(blocks) {
  const entries = blocks.flatMap((block, index) => {
    const text = String(block.text || '').trim().replace(/^#{1,6}\s+/, '');
    if (!text || block.resource) return [];
    const label = referenceHeading.exec(text);
    const rest = label ? text.slice(label[0].length) : '';
    const inline = Boolean(label && isReferenceEntry(rest));
    return [{ index, text, heading: block.heading || /^#{1,6}\s/.test(block.sourceMarkdown || ''),
      entry: isReferenceEntry(text), explicit: Boolean(label && (!rest || inline)), inline }];
  });
  const ids = new Set();
  let start = entries.findIndex(item => item.explicit);
  if (start < 0) start = implicitStart(entries);
  while (start >= 0 && start < entries.length) {
    const end = sectionEnd(entries, start);
    const endIndex = entries[end]?.index ?? blocks.length;
    for (let i = entries[start].index; i < endIndex; i++) ids.add(blocks[i].id);
    start = end;
    while (start < entries.length && !entries[start].explicit) start++;
  }
  return ids;
}
