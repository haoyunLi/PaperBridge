import { usesSharedMarkdown, completedBlockTranslation } from './academicMarkdown.mjs';
import { annotationsMarkdown } from './annotationsMarkdown.mjs';
import { referenceBlockIds, revalidateSummaryClaims } from './paper.mjs';
import { connectedTranslationMarkdown } from './connectedTranslationExport.mjs';

const sourceText = block => block.sourceMarkdown || block.text;

function quoteTranslation(target, targetLanguage) {
  const quote = target.split('\n').map(line => line ? `> ${line}` : '>').join('\n');
  return `> **${targetLanguage} translation**\n>\n${quote}`;
}

function analysisDocument(paper, annotations, references, targetLanguage) {
  const evidence = (revalidateSummaryClaims(paper.summary?.claims, paper.blocks) || []).map((claim, index) =>
    `### Claim ${index + 1}: ${claim.text}\n\n${claim.sources?.length ? claim.sources.map(source => `- Block ${source.paragraphID}: “${source.quote}”`).join('\n') : '- No exact source quotation validated.'}`).join('\n\n');
  const paragraphs = paper.blocks.filter(block => !block.resource && !references.has(block.id)).map(block => {
    const translation = block.status === 'ok' ? block.translationMarkdown || block.translation
      : block.error ? `[Translation failed] ${block.error}` : '[Translation unavailable]';
    return `### Paragraph ${block.id}\n\n${sourceText(block)}\n\n**Translation**\n\n${translation || '[Translation unavailable]'}`;
  }).join('\n\n');
  const draft = paper.connectedTranslation
    ? `\n\n## Connected Full Translation\n\n${connectedTranslationMarkdown(paper, targetLanguage)}` : '';
  const referenceNotice = references.size ? '> The reference section was excluded from translation.\n\n' : '';
  const sourceNotice = Array.isArray(paper.summary?.claims)
    ? '> AI interpretation is unverified. Matching a quotation confirms its location, not whether it supports the claim.\n\n' : '';
  return `# ${paper.name}\n\n${referenceNotice}## Source summary\n\n${paper.summary?.source || ''}\n\n## Target summary\n\n${paper.summary?.target || ''}\n\n## Checked sources\n\n${sourceNotice}${evidence || 'No exact source quotations validated.'}${draft}${paragraphs ? `\n\n## Paragraphs\n\n${paragraphs}` : ''}\n\n${annotations}`;
}

export function markdownDocuments(paper, targetLanguage, kind) {
  const annotations = annotationsMarkdown(paper);
  const references = referenceBlockIds(paper.blocks);
  const analysis = () => ({ kind: 'analysis', name: 'Analysis', content: analysisDocument(paper, annotations, references, targetLanguage) });
  if (kind === 'analysis') return [analysis()];

  const structured = usesSharedMarkdown(paper);
  const facsimile = !kind && paper.type === 'pdf' && !structured;
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
      return `${source}\n\n${quoteTranslation(target || '[Translation unavailable]', targetLanguage)}`;
    }
    const target = block.translationMarkdown || block.translation || '*Not translated*';
    return block.heading ? `${source}\n\n${target}` : `### ${block.id}\n\n${source}\n\n${target}`;
  }).join('\n\n');
  const documents = [
    { kind: 'original', name: 'Original', content: original },
    { kind: 'translated', name: 'Translated', content: translated },
    { kind: 'bilingual', name: 'Bilingual', content: `${bilingual}\n\n${annotations}` }
  ];
  if (!kind) documents.push(analysis());
  if (paper.connectedTranslation) {
    const content = !kind && structured && !paper.connectedStale ? translated : paper.connectedTranslation;
    documents.push({ kind: 'full', name: 'Full Translation', content: connectedTranslationMarkdown(paper, targetLanguage, content) });
  }
  return kind ? documents.filter(document => document.kind === kind) : documents;
}
