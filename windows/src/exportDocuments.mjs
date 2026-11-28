import { structuredBlockSource as sourceText } from '../electron/markdown-code-context.mjs';
import { usesSharedMarkdown, completedBlockTranslation, restoreStructuredTranslations } from './academicMarkdown.mjs';
import { parseMarkdown } from './markdownRendering.mjs';
import { analysisAnnotations, annotationsMarkdown } from './annotationsMarkdown.mjs';
import { referenceBlockIds, revalidateSummaryClaims, summaryNeedsTextRefresh, legacySummaryTextNotice, staleSummaryNotice } from './paper.mjs';
import { connectedTranslationMarkdown } from './connectedTranslationExport.mjs';
import { commonOutputLanguage, languageCodes, migrateOutputLanguages, normalizeOutputLanguage, readerOutputLanguage } from './outputLanguages.mjs';

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
  // The native analysis export already uses "_bilingual". An unlabelled reading edition needs its own filename.
  const edition = document.kind === 'bilingual' && suffix === 'bilingual' ? 'bilingual_text' : suffix;
  return `${stem}_${edition}`;
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
  if (summary.stale) sections.unshift('> ' + staleSummaryNotice);
  else if (summaryNeedsTextRefresh(paper)) sections.push('> ' + legacySummaryTextNotice);
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

// The analysis report has its own outline. A paper heading belongs inside
// its numbered paragraph, and inline links and scientific notation still apply.
function analysisParagraphBody(block, markdown) {
  if (!block.sourceMarkdown || !markdown || !/^\s*#{1,6}[ \t]/.test(markdown)) return markdown;
  const blocks = parseMarkdown(markdown).children;
  if (blocks.length !== 1 || blocks[0].type !== 'heading') return markdown;
  const inline = blocks[0].children;
  if (!inline.length) return '';
  const body = markdown.slice(inline[0].position.start.offset, inline.at(-1).position.end.offset);
  if (parseMarkdown(body).children[0]?.type === 'paragraph') return body;
  // A heading title may itself begin with a list marker or a literal hash.
  return body.replace(/^\S/u, first => `&#${first.codePointAt(0)};`);
}

function analysisDocument(paper, references) {
  const eligible = paper.blocks.filter(block => !block.resource && !references.has(block.id));
  const annotations = analysisAnnotations(paper, new Set(eligible.map(block => block.id)));
  const paragraphs = eligible.map(block => {
    const translation = block.status === 'ok' ? block.translationMarkdown || block.translation
      : block.error ? `[Translation failed] ${block.error}` : '[Translation unavailable]';
    const original = analysisParagraphBody(block, sourceText(block));
    const target = analysisParagraphBody(block, translation) || '[Translation unavailable]';
    const saved = annotations.paragraphs.get(block.id);
    const language = normalizeOutputLanguage(block.translationLanguage);
    return `### Paragraph ${block.id}\n\n${block.bookmark ? '> Bookmarked in PaperBridge\n\n' : ''}#### Original${language ? ` ${language.sourceLanguage}` : ''}\n\n${original}\n\n#### ${labeled('Translation', block.status === 'ok' ? language?.targetLanguage : null)}\n\n${target}${saved ? `\n\n${saved}` : ''}`;
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
  const descriptor = (kind, name, content, language = readerLanguage) => ({
    kind, name, filename: filenameFor(kind, language), content,
    ...(facsimile && kind === 'translated' && language ? { targetLanguage: language.targetLanguage } : {})
  });
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
  const scanNotice = paper.type === 'pdf' && !structured && !original.trim()
    ? '> No selectable text was found. Translation requires a PDF text layer or an OCR parser.' : '';
  const documents = [
    descriptor('original', 'Original', original),
    descriptor('translated', 'Translated', translated || scanNotice),
    descriptor('bilingual', 'Bilingual', [bilingual || scanNotice, annotations].filter(Boolean).join('\n\n'))
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
