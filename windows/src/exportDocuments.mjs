import { usesSharedMarkdown, completedBlockTranslation, restoreStructuredTranslations } from './academicMarkdown.mjs';
import { analysisAnnotations, annotationsMarkdown } from './annotationsMarkdown.mjs';
import { referenceBlockIds, revalidateSummaryClaims, summaryNeedsTextRefresh, legacySummaryTextNotice } from './paper.mjs';
import { connectedTranslationMarkdown } from './connectedTranslationExport.mjs';
import { commonOutputLanguage, migrateOutputLanguages, normalizeOutputLanguage, readerOutputLanguage } from './outputLanguages.mjs';

const sourceText = block => block.sourceMarkdown || block.text;
const languageCodes = Object.freeze({ English: 'en', 'Simplified Chinese': 'zh-Hans', 'Traditional Chinese': 'zh-Hant',
  Japanese: 'ja', Korean: 'ko', French: 'fr', German: 'de', Spanish: 'es', Italian: 'it', Portuguese: 'pt', Russian: 'ru' });
const knownLanguage = value => Object.hasOwn(languageCodes, value) ? value : null;
const labeled = (label, language) => language ? `${label} (${language})` : label;
const filenameFor = (kind, pair) => {
  const source = pair && languageCodes[pair.sourceLanguage], target = pair && languageCodes[pair.targetLanguage];
  return ({ original: 'paper_original.md', analysis: 'paper_analysis_notes.md',
    translated: `paper_translation${target ? `_${target}` : ''}.md`,
    bilingual: `paper_bilingual${source && target ? `_${source}_${target}` : ''}.md`,
    full: `paper_full_translation${target ? `_${target}` : ''}.md` })[kind];
};

export function markdownExportName(paper, document) {
  const basename = String(paper.name || 'PaperBridge').split(/[\\/]/).at(-1);
  const stem = basename.replace(/\.[^.]*$/, '') || 'PaperBridge';
  const suffix = document.kind === 'analysis' ? 'bilingual'
    : (document.filename || filenameFor(document.kind, null)).replace(/^paper_/, '').replace(/\.md$/i, '');
  return `${stem}_${suffix}`;
}

function quoteTranslation(target, targetLanguage) {
  const quote = target.split('\n').map(line => line ? `> ${line}` : '>').join('\n');
  return `> **${targetLanguage ? `${targetLanguage} translation` : 'Translation'}**\n>\n${quote}`;
}

function analysisSummary(paper) {
  const { summary } = paper;
  if (!summary) return '';
  const heading = (language, fallback) => knownLanguage(language) ? labeled('Whole-paper summary', language) : fallback;
  const sections = [
    `## ${heading(summary.sourceLanguage, 'Source summary')}\n\n${summary.source || ''}`,
    `## ${heading(summary.targetLanguage, 'Target summary')}\n\n${summary.target || ''}`
  ];
  if (summaryNeedsTextRefresh(paper)) sections.push('> ' + legacySummaryTextNotice);
  const claims = revalidateSummaryClaims(summary.claims, paper.blocks);
  if (claims) {
    sections.push('### Summary source passages\n> AI interpretation is unverified. Matching a quotation confirms its location, not whether it supports the claim.');
    for (const [index, claim] of claims.entries()) {
      sections.push(`**Claim ${index + 1}**: ${claim.text}`);
      if (!claim.sources.length) sections.push('No source link validated.');
      for (const source of claim.sources) {
        const quote = source.quote.split(/\r\n|\r|\n/).map(line => '> ' + line).join('\n');
        sections.push(`Original paragraph ${source.paragraphID}:\n${quote}`);
      }
    }
  }
  return sections.join('\n\n');
}

function analysisDocument(paper, references) {
  const eligible = paper.blocks.filter(block => !block.resource && !references.has(block.id));
  const annotations = analysisAnnotations(paper, new Set(eligible.map(block => block.id)));
  const paragraphs = eligible.map(block => {
    const translation = block.status === 'ok' ? block.translationMarkdown || block.translation
      : block.error ? `[Translation failed] ${block.error}` : '[Translation unavailable]';
    const saved = annotations.paragraphs.get(block.id);
    const language = normalizeOutputLanguage(block.translationLanguage);
    return `### Paragraph ${block.id}\n\n${block.bookmark ? '> Bookmarked in PaperBridge\n\n' : ''}#### Original${language ? ` ${language.sourceLanguage}` : ''}\n\n${sourceText(block)}\n\n#### ${labeled('Translation', block.status === 'ok' ? language?.targetLanguage : null)}\n\n${translation || '[Translation unavailable]'}${saved ? `\n\n${saved}` : ''}`;
  }).join('\n\n');
  const connectedLanguage = normalizeOutputLanguage(paper.connectedLanguage);
  const draft = paper.connectedTranslation
    ? `## ${labeled('Connected Full Translation', connectedLanguage?.targetLanguage)}\n\n${connectedTranslationMarkdown(paper)}` : '';
  const referenceNotice = references.size ? '> The reference section was excluded from translation.' : '';
  return [`# ${paper.name}`, referenceNotice, analysisSummary(paper), draft, paragraphs && `## Paragraphs\n\n${paragraphs}`, annotations.appendix]
    .filter(Boolean).join('\n\n');
}

export function markdownDocuments(input, _legacyTargetLanguage, kind) {
  const paper = restoreStructuredTranslations(migrateOutputLanguages(input));
  const references = referenceBlockIds(paper.blocks);
  const structured = usesSharedMarkdown(paper);
  const facsimile = !kind && paper.type === 'pdf' && !structured;
  const completed = paper.blocks.filter(block => completedBlockTranslation(block, references));
  const readerLanguage = structured || facsimile
    ? completed.length ? commonOutputLanguage(completed.map(block => block.translationLanguage)) : readerOutputLanguage({ ...paper, blocks: [] })
    : readerOutputLanguage(paper);
  const descriptor = (kind, name, content, language = readerLanguage) => ({ kind, name, filename: filenameFor(kind, language), content });
  const analysis = () => descriptor('analysis', 'Analysis', analysisDocument(paper, references));
  if (kind === 'analysis') return [analysis()];
  const annotations = annotationsMarkdown(paper);

  const original = structured && paper.mineruMarkdown?.trim()
    ? paper.mineruMarkdown : paper.blocks.map(sourceText).join('\n\n');
  const translated = paper.blocks.map(block => {
    if (structured || facsimile) return completedBlockTranslation(block, references) || sourceText(block);
    if (block.resource || references.has(block.id)) return sourceText(block);
    return block.translationMarkdown || block.translation || `[Untranslated block ${block.id}]`;
  }).join('\n\n');
  const bilingual = paper.blocks.map(block => {
    const source = sourceText(block);
    if (block.resource || references.has(block.id)) return source;
    if (structured || facsimile) {
      const target = completedBlockTranslation(block, references);
      if (structured && !target) return source;
      if (structured && block.heading) return `${source}\n\n${target}`;
      return `${source}\n\n${quoteTranslation(target || '[Translation unavailable]', target ? normalizeOutputLanguage(block.translationLanguage)?.targetLanguage : null)}`;
    }
    const target = block.translationMarkdown || block.translation || '*Not translated*';
    return block.heading ? `${source}\n\n${target}` : `### ${block.id}\n\n${source}\n\n${target}`;
  }).join('\n\n');
  const documents = [
    descriptor('original', 'Original', original),
    descriptor('translated', 'Translated', translated),
    descriptor('bilingual', 'Bilingual', `${bilingual}\n\n${annotations}`)
  ];
  if (!kind) documents.push(analysis());
  if (paper.connectedTranslation) {
    const rebuilt = !kind && structured && !paper.connectedStale;
    const content = rebuilt ? translated : paper.connectedTranslation;
    const language = rebuilt ? readerLanguage : normalizeOutputLanguage(paper.connectedLanguage);
    documents.push(descriptor('full', 'Full Translation', connectedTranslationMarkdown(paper, undefined, content, rebuilt ? language : undefined), language));
  }
  return kind ? documents.filter(document => document.kind === kind) : documents;
}
