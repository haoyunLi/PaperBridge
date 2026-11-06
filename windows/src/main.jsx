import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { BookOpen, FilePlus2, FolderOpen, Search, Settings2, Languages, Bookmark, Highlighter, MessageSquareText, Download, X, PanelRightClose, PanelRightOpen, ArrowRightLeft, Play, Square, RefreshCw, FileText, Library, ChevronLeft, ChevronRight, List, Sparkles, Pencil, Trash2, Undo2, Merge, Scissors, Focus, PanelLeftClose, PanelLeftOpen, Check, AlertCircle } from 'lucide-react';
import { openPdf, extractPdf } from './pdf.mjs';
import { isPdfScope, pdfAnnotationScope, validPdfSelection, pdfAnchorKey, pdfAnchors, samePdfSelection, storedPdfAnchors, pdfPageLabel } from './pdfAnchors.mjs';
import { blockMarkdown, isMarkdownView, markdownAnnotationOffset, matchingTextOffset, paperArticleAnchorAvailable, paperArticleSource, sameTextAnchor, sameViewAnchor, selectionOffsets, textAnchorAvailable, validTextSelection } from './markdownAnchors.mjs';
import { blocksFromText, readingMap, chunkText, isHeading } from './text.mjs';
import { translationSystem, selectionTranslationSystem, translationPrompt, selectionTranslationCacheVersion, selectionContext, spansCompleteSentences, selectionTranslationPrompt, strictSelectionTranslationPrompt, isLikelyOverexpandedSelection, explainPrompt, summaryPrompt, mergeSummaryPrompt, summaryQuotePrompt, protectMarkdown, restoreMarkdown, markdownTranslationPrompt, omitInlineImageData, connectedTranslationPrompt } from './prompts.mjs';
import { libraryLabel, referenceBlockIds, sectionRanges, translationRangeIds, qualityIssues, summarySourceBlocks, summarySourceBatches, parseSummaryClaims, summarySourceCandidates, claimsMarkdown, revalidateSummaryClaims, remapSummaryEvidence, splitBlockNearMiddle, reflowBlock, mergeBlocks, editedParagraphs } from './paper.mjs';
import { anchorText, readableMineruBlocks, usesSharedMarkdown, withSharedMarkdownTranslation } from './academicMarkdown.mjs';
import { TASK_SETTING_KEYS, snapshotPaperSettings, restorePaperSettings } from './paperSettings.mjs';
import { switchOutputSettings, switchReadingSource, migrateExplanations, cachedExplanation, explanationKey } from './outputCache.mjs';
import { createUndoEntry, applyUndoEntry } from './paperUndo.mjs';
import { annotationsMarkdown } from './annotationsMarkdown.mjs';
import { applySelectionNote, findSelectionNote, noteSelectionIdentity, sameNoteSelection, validNoteSelection, viewText } from './noteAnnotations.mjs';
import { createPaperSaveQueue } from './paperSaveQueue.mjs';
import { createReadingHistory } from './readingHistory.mjs';
import SetupPanel from './SetupPanel.jsx';
import Onboarding from './Onboarding.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import { modelSettingsPatch } from './modelCatalog.mjs';
import { activeAIModel, aiCacheNamespace, translationInstructions, openAISetupMessage, isGlobalOpenAIError } from './aiSettings.mjs';
import { mineruImportStage } from './importProgress.mjs';
import { connectedBatchVersion, pendingConnectedBatches, planConnectedBatches, restoreConnectedExcerpt } from './connectedTranslation.mjs';
import { canSaveTermSource, glossaryTermMatchesQuery, matchingGlossaryTerms, upsertGlossaryTerm } from './terminology.mjs';
import './onboarding.css';
import 'katex/dist/katex.min.css';
import './style.css';
import './hardware.css';
import './parity.css';
import './save-status.css';

const api = window.paperBridge;
const ONBOARDING_VERSION = 1;
const selectionIdentity = value => value ? JSON.stringify([value.scope, value.id, value.page, value.kind, value.offset, value.text, value.anchors && pdfAnchorKey(value), value.renderedAnchor, value.displayMode, value.sourceMode]) : '';
const pdfScrollKey = (scope, page) => `Pdf:${scope}:${page}`;
const languages = ['English', 'Simplified Chinese', 'Traditional Chinese', 'Japanese', 'Korean', 'French', 'German', 'Spanish', 'Italian', 'Portuguese', 'Russian'];
const sample = ['Abstract', 'This is a fictional practice document, not a published study. Use it to explore source-linked reading, translation, highlights, and notes without importing a personal paper.', '1 Introduction', 'Reading a paper across languages involves more than translating its sentences. Readers need to connect a claim to the method and evidence that support it.', '2 Methods', 'Start with the reading map, then open the linked source passage. Translate one paragraph when needed, or translate the whole document with a local Ollama model.', '3 Results', 'Selecting a phrase opens tools for translation, explanation, highlighting, and notes. This practice document contains no measured results or claims about model accuracy.', '4 Limitations', 'A summary is a reading aid, not a substitute for evidence. PDF text extraction and local models can make mistakes; compare uncertain passages with the Original PDF when one is available.', '5 Conclusion', 'Keep useful passages in bookmarks, retain your notes, and export the material you want to revisit. This sample requires no model until you choose an AI action.'];
const markdownPlugins = [remarkGfm, remarkMath];
const markdownSchema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src || []), 'data'] }
};
const rehypePlugins = [rehypeRaw, [rehypeSanitize, markdownSchema], rehypeKatex];
const richHighlights = new Map();
const annotationStyles = ['amber', 'teal', 'blue', 'coral', 'note'];
const currentHighlightColors = ['amber', 'teal', 'coral'];

function safeMarkdownUrl(url, key) { return key === 'src' && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(url) ? url : defaultUrlTransform(url); }
function refreshRichHighlights() {
  if (!CSS.highlights) return;
  for (const style of annotationStyles) {
    const ranges = [...richHighlights.values()].flatMap(entry => entry[style]);
    if (ranges.length) {
      const highlight = new Highlight(...ranges);
      if (style === 'note') highlight.priority = 1;
      CSS.highlights.set(`paperbridge-${style}`, highlight);
    } else CSS.highlights.delete(`paperbridge-${style}`);
  }
}
function hiddenSelectionText(node) {
  return (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('.katex-mathml, [data-selection-ignore]');
}
function textWalker(root, visibleOnly) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, visibleOnly ? {
    acceptNode: node => hiddenSelectionText(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  } : null);
}
const readingKeys = {
  ArrowLeft: ['left', 'character', 'word'],
  ArrowRight: ['right', 'character', 'word'],
  ArrowUp: ['backward', 'line', 'paragraph'],
  ArrowDown: ['forward', 'line', 'paragraph'],
  Home: ['backward', 'lineboundary'],
  End: ['forward', 'lineboundary']
};
function readingBoundary(root, end) {
  if (!root) return null;
  const walker = textWalker(root, true);
  let boundary;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    boundary = node;
    if (!end) break;
  }
  return boundary;
}
function moveReadingSelection(event, region, initialRegion, pdf) {
  const key = readingKeys[event.key];
  if (!Array.isArray(key) || event.defaultPrevented || event.altKey || event.metaKey || event.isComposing || !region) return false;
  const selected = window.getSelection();
  if (!selected) return false;
  const inside = node => region.contains(node) && !hiddenSelectionText(node) && (!pdf || Number.isInteger(pdfRangeEndpoint(node)));
  const hasCaret = inside(selected.anchorNode) && inside(selected.focusNode);
  // Keep ordinary vertical navigation and Home/End scrolling outside a selection.
  if (!event.shiftKey && (!hasCaret || (selected.isCollapsed && key[1] !== 'character'))) return false;
  if (!hasCaret) {
    const start = initialRegion && readingBoundary(initialRegion, false);
    if (!start) return false;
    selected.collapse(start, 0);
  }
  event.preventDefault();
  const previous = [selected.anchorNode, selected.anchorOffset, selected.focusNode, selected.focusOffset];
  if (event.ctrlKey && !key[2]) {
    const end = event.key === 'End';
    const edge = readingBoundary(pdf ? initialRegion : region, end);
    if (edge) selected[event.shiftKey ? 'extend' : 'collapse'](edge, end ? edge.length : 0);
  } else {
    // Use Chromium's character, word and visual line boundaries.
    selected.modify(event.shiftKey ? 'extend' : 'move', key[0], event.ctrlKey ? key[2] : key[1]);
  }
  if (!inside(selected.anchorNode) || !inside(selected.focusNode)) selected.setBaseAndExtent(...previous);
  return true;
}
function domText(root, visibleOnly) {
  if (!root || !visibleOnly) return root?.textContent || '';
  const walker = textWalker(root, true);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text += node.textContent;
  return text;
}
function annotationRanges(root, annotations, source) {
  const walker = textWalker(root, true);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: nodes.length ? nodes.at(-1).end : 0, end: 0 });
    nodes.at(-1).end = nodes.at(-1).start + node.textContent.length;
  }
  const text = nodes.map(item => item.node.textContent).join('');
  const result = Object.fromEntries(annotationStyles.map(style => [style, []]));
  for (const item of annotations) {
    const style = item.color || (typeof item.body === 'string' && item.body.trim() ? 'note' : null);
    if (!Object.hasOwn(result, style)) continue;
    const at = markdownAnnotationOffset(text, item, source);
    if (at === null) continue;
    const start = nodes.find(item => item.end > at);
    const end = nodes.find(node => node.end >= at + item.text.length);
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(start.node, at - start.start);
    range.setEnd(end.node, at + item.text.length - end.start);
    result[style].push(range);
  }
  return result;
}
function useRichAnnotations(host, content, annotations, source) {
  const highlightKey = useRef({});
  useEffect(() => {
    if (!annotations?.length || !host.current || !CSS.highlights) return;
    richHighlights.set(highlightKey.current, annotationRanges(host.current, annotations, source));
    refreshRichHighlights();
    return () => { richHighlights.delete(highlightKey.current); refreshRichHighlights(); };
  }, [host, content, annotations, source]);
}
function Markdown({ children, annotations, annotationSource = children }) {
  const host = useRef(null);
  useRichAnnotations(host, children, annotations, annotationSource);
  return <div ref={host} data-markdown-host><ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={rehypePlugins} urlTransform={safeMarkdownUrl}>{children || ''}</ReactMarkdown></div>;
}
function short(text, count = 92) { return text?.length > count ? `${text.slice(0, count)}…` : text; }
function afterReadingLayout(host, restore) {
  requestAnimationFrame(() => {
    const pendingFigures = [...(host?.querySelectorAll('img[src^="data:image/"]') || [])].filter(image => !image.complete);
    // Embedded MinerU figures can grow the preview after its text is ready.
    if (pendingFigures.length) void Promise.allSettled(pendingFigures.map(image => image.decode())).then(() => requestAnimationFrame(restore));
    else requestAnimationFrame(restore);
  });
}
function domRangeIn(root, range, visibleOnly = false) {
  if (!root || !range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  if (visibleOnly && (hiddenSelectionText(range.startContainer) || hiddenSelectionText(range.endContainer))) return null;
  const raw = domText(range.cloneContents(), visibleOnly);
  const text = raw.trim();
  if (!text || text.length > 3000) return null;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const offset = domText(before.cloneContents(), visibleOnly).length + raw.length - raw.trimStart().length;
  const rect = range.getBoundingClientRect();
  return { text, offset, rect: { x: rect.left, y: rect.top }, context: domText(root, visibleOnly) };
}
function textSelectionOffsets(captured, source, markdown) {
  return selectionOffsets(captured, matchingTextOffset(captured.context, source, captured.text, captured.offset), markdown, source);
}
function textRangeAt(root, offset, length, visibleOnly = false) {
  if (!root || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length <= 0) return null;
  const walker = textWalker(root, visibleOnly);
  let node; let seen = 0; let first = null; let last = null;
  while ((node = walker.nextNode())) {
    const next = seen + node.textContent.length;
    if (!first && next > offset) first = { node, at: offset - seen };
    if (first && next >= offset + length) { last = { node, at: offset + length - seen }; break; }
    seen = next;
  }
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, first.at);
  range.setEnd(last.node, last.at);
  return range;
}
function readablePdfRange(range) {
  const fragment = range.cloneContents();
  for (const lineBreak of fragment.querySelectorAll('br')) lineBreak.replaceWith(' ');
  return fragment.textContent.replace(/\s+/g, ' ').trim();
}
function pdfSelectionContent(root, range, text, offset, pageText) {
  // The visible quote includes line breaks represented by elements, separate from saved text offsets.
  const quote = readablePdfRange(range);
  const start = Math.max(0, offset - 300);
  const end = Math.min(pageText.length, offset + text.length + 300);
  const context = textRangeAt(root, start, end - start);
  return { text, offset, pageText, quote: quote !== text ? quote : undefined, context: context ? readablePdfRange(context) : quote };
}
function validViewAnchor(paper, item) {
  if (item.scope === 'paperArticle') return !item.needsReview && paperArticleAnchorAvailable(paper, item);
  const source = viewText(paper, item.scope);
  return !item.needsReview && textAnchorAvailable(item, source, source);
}
function markdownViewTab(scope) {
  if (scope === 'paperArticle') return 'Paper';
  return scope === 'fullTranslation' ? 'Full Translation' : 'Summary';
}
function markdownViewLabel(scope) {
  return scope === 'paperArticle' ? 'Paper · document preview' : scope;
}
function validBlockAnchor(block, item, kind, markdown = blockMarkdown(block, kind)) {
  return !item?.needsReview && textAnchorAvailable(item, anchorText(block, kind), markdown);
}
function blockAnnotationScope(item) { return item?.scope === 'paper' ? 'paper' : 'reader'; }
function blockAnnotationsFor(items, scope) { return (items || []).filter(item => blockAnnotationScope(item) === scope); }
function viewAnnotations(paper, scope) {
  return [...(paper.viewHighlights || []), ...(paper.viewNotes || [])]
    .filter(item => item.scope === scope && validViewAnchor(paper, item));
}
function pdfAnnotationsFor(paper, scope) {
  return [...(paper.pdfHighlights || []), ...(paper.pdfNotes || [])].filter(item => pdfAnnotationScope(item) === scope);
}
function displayHighlightColor(color) { return color === 'blue' ? 'teal' : color; }
function highlightColorName(color) { return color === 'teal' ? 'Cobalt' : `${color[0].toUpperCase()}${color.slice(1)}`; }
function highlightMatchesSelection(item, selection) {
  if (!item || item.needsReview || !selection) return false;
  if (isPdfScope(selection.scope)) return samePdfSelection(item, selection);
  if (isMarkdownView(selection.scope)) return sameViewAnchor(item, selection);
  return blockAnnotationScope(item) === selection.scope && sameTextAnchor(item, selection);
}
function selectionHighlights(paper, selection) {
  if (!paper || !selection) return [];
  if (isPdfScope(selection.scope)) return (paper.pdfHighlights || []).filter(item => highlightMatchesSelection(item, selection));
  if (isMarkdownView(selection.scope)) return (paper.viewHighlights || []).filter(item => highlightMatchesSelection(item, selection));
  const block = paper.blocks?.find(item => item.id === selection.id);
  const items = selection.kind === 'translation' ? block?.translationHighlights : block?.highlights;
  return (items || []).filter(item => highlightMatchesSelection(item, selection));
}
function markdownDocuments(paper) {
  const references = referenceBlockIds(paper.blocks);
  const original = paper.blocks.map(block => block.sourceMarkdown || block.text).join('\n\n');
  const translated = paper.blocks.map(block => {
    if (block.resource || references.has(block.id)) return block.sourceMarkdown || block.text;
    return block.translationMarkdown || block.translation || `[Untranslated block ${block.id}]`;
  }).join('\n\n');
  const bilingual = paper.blocks.map(block => {
    const source = block.sourceMarkdown || block.text;
    const target = block.translationMarkdown || block.translation || '*Not translated*';
    if (block.resource || references.has(block.id)) return source;
    return block.heading ? `${source}\n\n${target}` : `### ${block.id}\n\n${source}\n\n${target}`;
  }).join('\n\n');
  const evidence = (revalidateSummaryClaims(paper.summary?.claims, paper.blocks) || []).map((claim, index) => `### Claim ${index + 1}: ${claim.text}\n\n${claim.sources?.length ? claim.sources.map(source => `- Block ${source.paragraphID}: “${source.quote}”`).join('\n') : '- No exact source quotation validated.'}`).join('\n\n');
  const annotations = annotationsMarkdown(paper);
  const documents = [
    { kind: 'original', name: 'Original', content: original },
    { kind: 'translated', name: 'Translated', content: translated },
    { kind: 'bilingual', name: 'Bilingual', content: `${bilingual}\n\n${annotations}` },
    { kind: 'analysis', name: 'Analysis', content: `# ${paper.name}\n\n## Source summary\n\n${paper.summary?.source || ''}\n\n## Target summary\n\n${paper.summary?.target || ''}\n\n## Checked sources\n\n${evidence || 'No exact source quotations validated.'}\n\n${annotations}` }
  ];
  if (paper.connectedTranslation) documents.push({ kind: 'full', name: 'Full Translation', content: paper.connectedTranslation });
  return documents;
}
function withHighlight(text, highlights = []) {
  if (!highlights.length) return text;
  const spans = [];
  for (const highlight of highlights) {
    if (highlight.needsReview || highlight.renderedAnchor) continue;
    const stored = Number.isInteger(highlight.offset) && text.slice(highlight.offset, highlight.offset + highlight.text.length) === highlight.text ? highlight.offset : -1;
    const first = text.indexOf(highlight.text);
    const at = stored >= 0 ? stored : first >= 0 && first === text.lastIndexOf(highlight.text) ? first : -1;
    if (at >= 0) spans.push({ start: at, end: at + highlight.text.length, color: highlight.color });
  }
  spans.sort((a, b) => a.start - b.start);
  const nodes = []; let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    nodes.push(text.slice(cursor, span.start));
    nodes.push(<mark key={`${span.start}-${span.end}`} className={`mark-${span.color}`}>{text.slice(span.start, span.end)}</mark>);
    cursor = span.end;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}
function PlainText({ as: Element = 'div', children, highlights, notes, ...attributes }) {
  const host = useRef(null);
  const content = withHighlight(children, highlights);
  useRichAnnotations(host, content, notes, children);
  return <Element ref={host} {...attributes}>{content}</Element>;
}
function BlockPassage({ block, kind, scope, structured = true, ...attributes }) {
  const translation = kind === 'translation';
  const text = translation ? block.translation : block.text;
  const markdown = structured && blockMarkdown(block, kind);
  const highlights = blockAnnotationsFor(translation ? block.translationHighlights : block.highlights, scope);
  const notes = blockAnnotationsFor(block.notes, scope)
    .filter(item => (item.kind || 'source') === kind && validBlockAnchor(block, item, kind, markdown || false));
  if (markdown) return <div {...attributes}><Markdown annotations={[...highlights, ...notes]} annotationSource={anchorText(block, kind)}>{markdown}</Markdown></div>;
  if (scope === 'paper') return <div {...attributes}>
    <PlainText as={block.heading ? 'h3' : 'p'} highlights={highlights} notes={notes}>{text}</PlainText>
  </div>;
  return <PlainText highlights={highlights} notes={notes} {...attributes}>{text}</PlainText>;
}
async function sha256(value) { const bytes = new TextEncoder().encode(value); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''); }

function usePdfDocument(paper) {
  const [loaded, setLoaded] = useState(null);
  const id = paper?.id;
  useEffect(() => {
    if (paper?.type !== 'pdf') return;
    let live = true;
    let opened;
    api.readPdf(id).then(bytes => live ? openPdf(bytes) : null).then(pdf => {
      opened = pdf;
      if (live) setLoaded({ id, pdf, error: '' });
      else return pdf?.loadingTask.destroy();
    }).catch(cause => { if (live) setLoaded({ id, pdf: null, error: cause.message }); });
    return () => { live = false; opened?.loadingTask.destroy().catch(() => {}); };
  }, [id, paper?.type]);
  return loaded?.id === id ? loaded : { pdf: null, error: '' };
}

function PdfSheet({ pdf, number, width, facsimile, annotations, onSize, onReady }) {
  const canvas = useRef(null);
  const layer = useRef(null);
  const highlightKey = useRef({});
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task;
    let textLayer;
    const surface = canvas.current;
    const root = layer.current;
    setRendered(false);
    if (root) { delete root.dataset.page; root.replaceChildren(); }
    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const targetWidth = facsimile ? Math.min(850, 1600 * base.width / base.height) : width;
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      onSize?.(number, base.height / base.width);
      const ratio = window.devicePixelRatio || 1;
      surface.width = Math.round(viewport.width * ratio);
      surface.height = Math.round(viewport.height * ratio);
      surface.style.width = viewport.width + 'px';
      surface.style.height = viewport.height + 'px';
      task = page.render({ canvasContext: surface.getContext('2d'), canvas: surface, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (cancelled) return;
      if (!root) { onReady?.(number, null); return; }
      root.style.width = viewport.width + 'px';
      root.style.height = viewport.height + 'px';
      const pdfjs = await import('pdfjs-dist');
      const textContentSource = await page.getTextContent();
      if (cancelled) return;
      textLayer = new pdfjs.TextLayer({ textContentSource, container: root, viewport });
      await textLayer.render();
      if (cancelled) return;
      root.dataset.page = String(number);
      setRendered(true);
      onReady?.(number, Boolean(root.textContent.trim()));
    })().catch(cause => { if (!cancelled) onReady?.(number, cause.message); });
    return () => { cancelled = true; task?.cancel(); textLayer?.cancel(); };
  }, [pdf, number, width, facsimile, onSize, onReady]);
  useEffect(() => {
    const root = layer.current;
    if (!rendered || root?.dataset.page !== String(number) || !CSS.highlights || !annotations?.length) return;
    const text = root.textContent;
    const valid = annotations.flatMap(item => item.needsReview ? [] : pdfAnchors(item).flatMap(anchor =>
      anchor.page === number && text.slice(anchor.offset, anchor.offset + anchor.text.length) === anchor.text
        ? [{ ...anchor, color: item.color, body: item.body }]
        : []
    ));
    if (!valid.length) return;
    const key = highlightKey.current;
    richHighlights.set(key, annotationRanges(root, valid));
    refreshRichHighlights();
    return () => { richHighlights.delete(key); refreshRichHighlights(); };
  }, [annotations, number, rendered]);
  return <div className="pdf-sheet"><canvas ref={canvas} aria-label={facsimile ? 'Original PDF page ' + number : undefined} role={facsimile ? 'img' : undefined} />{!facsimile && <div ref={layer} className="textLayer" />}</div>;
}

function pdfPageElement(host, page) {
  return host?.children[page - 1];
}

function pdfPageAt(host, position) {
  let low = 0;
  let high = host.children.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (host.children[mid].offsetTop <= position) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function pdfLayerFor(host, page) {
  return pdfPageElement(host, page)?.querySelector('.textLayer[data-page]');
}

function pdfRangeEndpoint(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return Number(element?.closest('.textLayer[data-page]')?.dataset.page);
}

function capturePdfRange(host, range) {
  if (!host || !range || !host.contains(range.startContainer) || !host.contains(range.endContainer)) return null;
  const first = pdfRangeEndpoint(range.startContainer);
  const last = pdfRangeEndpoint(range.endContainer);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) return null;
  const parts = [];
  for (let page = first; page <= last; page++) {
    const root = pdfLayerFor(host, page);
    if (!root) return null;
    const fragment = document.createRange();
    fragment.selectNodeContents(root);
    if (page === first) fragment.setStart(range.startContainer, range.startOffset);
    if (page === last) fragment.setEnd(range.endContainer, range.endOffset);
    if (!fragment.toString().trim()) continue;
    const captured = domRangeIn(root, fragment);
    if (!captured || captured.context.slice(captured.offset, captured.offset + captured.text.length) !== captured.text) return null;
    parts.push({ ...pdfSelectionContent(root, fragment, captured.text, captured.offset, captured.context), page });
  }
  if (!parts.length || parts.reduce((length, item) => length + (item.quote ?? item.text).length + 1, -1) > 3000) return null;
  const rect = range.getBoundingClientRect();
  const position = { x: rect.left, y: rect.top };
  if (parts.length === 1) return { ...parts[0], rect: position };
  const quote = parts.map(part => part.quote ?? part.text).join(' ');
  return { page: parts[0].page, offset: parts[0].offset, text: parts.map(part => part.text).join('\n'), quote, context: quote,
    anchors: parts.map(({ page, offset, text, pageText }) => ({ page, offset, text, pageText })), rect: position };
}

function PdfView({ paper, scope, pageNumber, position, restoreToken, annotations, selected, navigation, onPage, onScrollSelection, onSelect, onNavigate, onNavigationFailure, onOcr, onSetup, onReader }) {
  const { pdf, error } = usePdfDocument(paper);
  const scroller = useRef(null);
  const activePage = useRef(0);
  const activeOffset = useRef(0);
  const activePageTop = useRef(0);
  const layoutWidth = useRef(0);
  const scrollFrame = useRef(0);
  const scrollTimer = useRef(0);
  const lastJump = useRef(null);
  const lastRestore = useRef(null);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState({});
  const [statuses, setStatuses] = useState({});
  const [visible, setVisible] = useState([1, 1]);
  const [dragPage, setDragPage] = useState(null);
  const currentPage = Math.max(1, Math.min(pageNumber, pdf?.numPages ?? pageNumber));
  const pinned = navigation ?? selected;
  const selectFirst = pinned?.page;
  const selectLast = pdfAnchors(pinned).at(-1)?.page ?? selectFirst;
  const onSize = useCallback((number, ratio) => setSizes(current => current[number] === ratio ? current : { ...current, [number]: ratio }), []);
  const onReady = useCallback((number, status) => setStatuses(current => ({ ...current, [number]: status })), []);

  useLayoutEffect(() => {
    const host = scroller.current;
    if (!host || !pdf) return;
    const resize = () => setWidth(Math.min(850, Math.max(280, host.clientWidth - 28)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [pdf]);

  useLayoutEffect(() => {
    const host = scroller.current;
    const page = pdfPageElement(host, currentPage);
    if (!page) return;
    const navigationId = navigation?.id;
    const jump = activePage.current !== currentPage || lastRestore.current !== restoreToken ||
      (navigationId && lastJump.current !== navigationId);
    if (!jump && activePageTop.current === page.offsetTop && layoutWidth.current === width) return;
    clearTimeout(scrollTimer.current);
    cancelAnimationFrame(scrollFrame.current);
    activePage.current = currentPage;
    activePageTop.current = page.offsetTop;
    layoutWidth.current = width;
    if (jump) activeOffset.current = navigationId ? 0 : position;
    lastJump.current = navigationId;
    lastRestore.current = restoreToken;
    host.scrollTop = page.offsetTop + activeOffset.current;
    setVisible([currentPage, pdfPageAt(host, host.scrollTop + host.clientHeight)]);
  }, [pdf, currentPage, position, restoreToken, navigation?.id, width, sizes]);

  useLayoutEffect(() => () => {
    cancelAnimationFrame(scrollFrame.current);
    clearTimeout(scrollTimer.current);
  }, []);

  useEffect(() => {
    if (dragPage == null) return;
    const stopDragging = () => setDragPage(null);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('blur', stopDragging);
    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('blur', stopDragging);
    };
  }, [dragPage]);

  useEffect(() => {
    if (!navigation || !pdf) return;
    const host = scroller.current;
    const anchors = pdfAnchors(navigation);
    const ranges = [];
    for (const anchor of anchors) {
      if (!Number.isInteger(anchor.page) || anchor.page < 1 || typeof anchor.text !== 'string') { onNavigationFailure(); return; }
      const root = pdfLayerFor(host, anchor.page);
      if (!root) {
        if (anchor.page > pdf.numPages || typeof statuses[anchor.page] === 'string') onNavigationFailure();
        return;
      }
      const range = textRangeAt(root, anchor.offset, anchor.text.length);
      if (!range || range.toString() !== anchor.text) { onNavigationFailure(); return; }
      ranges.push(range);
    }
    if (!ranges.length) { onNavigationFailure(); return; }
    const first = ranges[0];
    const last = ranges.at(-1);
    const range = document.createRange();
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.endContainer, last.endOffset);
    const captured = capturePdfRange(host, range);
    if (!captured || !samePdfSelection({ ...captured, scope }, navigation)) { onNavigationFailure(); return; }
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const page = pdfPageElement(host, captured.page);
    const withinPage = first.getBoundingClientRect().top - page.getBoundingClientRect().top - 18;
    host.scrollTop = page.offsetTop + Math.max(0, withinPage);
    onNavigate(captured);
  }, [pdf, navigation?.id, statuses]);

  function handleScroll() {
    onScrollSelection();
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      const host = scroller.current;
      if (!host?.children.length) return;
      const top = host.scrollTop;
      const end = pdfPageAt(host, top + host.clientHeight);
      const page = top > 0 && host.scrollHeight - top - host.clientHeight < 2
        ? host.children.length
        : pdfPageAt(host, top + Math.min(36, host.clientHeight / 4));
      activePageTop.current = pdfPageElement(host, page).offsetTop;
      const offset = Math.max(0, top - activePageTop.current);
      activeOffset.current = offset;
      setVisible(current => current[0] === page && current[1] === end ? current : [page, end]);
      clearTimeout(scrollTimer.current);
      if (activePage.current !== page) {
        activePage.current = page;
        onPage(page, offset);
      } else scrollTimer.current = setTimeout(() => onPage(page, offset), 160);
    });
  }
  function capture() {
    const selection = window.getSelection();
    const captured = capturePdfRange(scroller.current, selection?.rangeCount ? selection.getRangeAt(0) : null);
    if (captured) onSelect(captured);
  }
  function jump(number) {
    clearTimeout(scrollTimer.current);
    cancelAnimationFrame(scrollFrame.current);
    window.getSelection()?.removeAllRanges();
    onPage(number, 0, true);
  }
  const pageStatus = statuses[currentPage];
  const [start, end] = visible[0] === currentPage ? visible : [currentPage, currentPage];
  const dragStart = dragPage == null ? Infinity : Math.min(dragPage, start);
  const dragEnd = dragPage == null ? 0 : Math.max(dragPage, end);
  if (paper?.type !== 'pdf') return <Empty title="No original PDF" body="This document was created from pasted text." />;
  const ocrReady = Boolean(paper.mineruBlocks?.length || paper.sourceMode === 'mineru' && paper.blocks.length);
  return <div className="pdf-panel">
    <PdfToolbar page={currentPage} count={pdf?.numPages} onPage={jump} />
    {pageStatus === false && <ScanNotice page ocrReady={ocrReady} onParse={onOcr} onSetup={onSetup} onReader={ocrReady || paper.blocks.length ? onReader : null} />}
    {(error || typeof pageStatus === 'string') && <Notice tone="error">{error || pageStatus}</Notice>}
    {pdf && <div className="pdf-scroll pdf-continuous" ref={scroller} data-pdf-scope={scope} tabIndex={0} aria-label="Continuous original PDF"
      onScroll={handleScroll} onMouseDown={event => {
        const number = pdfRangeEndpoint(event.target);
        if (event.button === 0 && Number.isInteger(number)) setDragPage(number);
      }} onMouseUp={capture}>
      {width > 0 && Array.from({ length: pdf.numPages }, (_, index) => {
        const number = index + 1;
        const mounted = number >= start - 1 && number <= end + 1 ||
          number >= dragStart && number <= dragEnd || number >= selectFirst && number <= selectLast;
        return <div className="pdf-page-slot" data-pdf-page={number} key={number} style={{ width, minHeight: width * (sizes[number] || 1.294) }}>
          {mounted && <PdfSheet pdf={pdf} number={number} width={width} annotations={annotations} onSize={onSize} onReady={onReady} />}
        </div>;
      })}
    </div>}
  </div>;
}
function PdfToolbar({ page, count, onPage }) {
  return <div className="pdf-toolbar"><span>Exact original PDF · page {page} of {count || '…'}</span><div className="row">
    <button className="icon-button" aria-label="Previous page" disabled={!count || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={17} /></button>
    <button className="icon-button" aria-label="Next page" disabled={!count || page >= count} onClick={() => onPage(page + 1)}><ChevronRight size={17} /></button>
  </div></div>;
}
function PdfFacsimile({ paper, pageNumber, onPage, onOriginal }) {
  const [expanded, setExpanded] = useState(true);
  return <section className="pdf-facsimile" aria-label="Original PDF reference">
    <div className="pdf-facsimile-heading">
      <button className="button ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide original page' : 'Show original page'}</button>
      <button className="button outline" onClick={onOriginal}>Open original PDF</button>
    </div>
    {expanded && <PdfReference paper={paper} pageNumber={pageNumber} onPage={onPage} />}
  </section>;
}
function PdfReference({ paper, pageNumber, onPage }) {
  const { pdf, error } = usePdfDocument(paper);
  const [renderError, setRenderError] = useState('');
  const onReady = useCallback((_number, cause) => setRenderError(cause), []);
  const page = Math.max(1, Math.min(pageNumber, pdf?.numPages ?? pageNumber));
  return <div className="pdf-panel">
    <PdfToolbar page={page} count={pdf?.numPages} onPage={onPage} />
    {(error || renderError) && <Notice tone="error">{error || renderError}</Notice>}
    {pdf && <div className="pdf-scroll"><PdfSheet key={page} pdf={pdf} number={page} facsimile onReady={onReady} /></div>}
  </div>;
}

function Empty({ title, body, children }) { return <div className="empty"><BookOpen size={36} strokeWidth={1.5} /><h2>{title}</h2><p>{body}</p>{children}</div>; }
function Notice({ children, tone = 'info', onClose }) { return <div className={`notice ${tone}`}><span>{children}</span>{onClose && <button className="icon-button" aria-label="Dismiss" onClick={onClose}><X size={15} /></button>}</div>; }
function TaskProgress({ busy, progress, failedCount }) {
  const total = Number.isFinite(progress?.total) && progress.total > 0 ? progress.total : null;
  const done = total === null ? null : Math.max(0, Math.min(total, progress.done || 0));
  return <div className="task-progress" role="status" aria-live="polite"><div className="task-progress-heading"><strong>{busy.label}</strong><span>{total === null ? 'Working…' : `${done} of ${total} processed`}{failedCount > 0 ? ` · ${failedCount} failed` : ''}</span></div><progress aria-label="Task progress" {...(total === null ? {} : { max: total, value: done })} /></div>;
}

function ImportProgress({ item, elapsed, onCancel }) {
  return <div className="import-progress-screen" role="status"><div className="import-progress-card"><FileText size={42} /><small>IMPORTING PDF</small><strong className="import-filename">{item.name}</strong><p>{item.stage}</p><strong>{elapsed}s elapsed</strong><div className="import-progress-bar"><span /></div><button className="button danger" onClick={onCancel}><Square size={14} />Cancel Import</button><p className="import-preserve-note">Your previous paper, translations, notes, bookmarks, and reading position remain unchanged until this import succeeds.</p></div></div>;
}
function ScanNotice({ page = false, ocrReady = false, onParse, onSetup, onReader }) {
  return <div className="scan-notice" role="status"><AlertCircle size={20} /><div><strong>{page ? 'No selectable text on this PDF page' : 'No selectable text in this PDF'}</strong><p>{ocrReady ? 'MinerU OCR text is ready in Reader. The original PDF remains unchanged.' : 'The original page remains available. Use MinerU OCR to recover text before translating or summarizing it.'}</p><div className="row">{ocrReady ? <button className="button blue" onClick={onReader}>Open OCR Reader</button> : <><button className="button blue" onClick={onParse}>Parse with MinerU</button><button className="button outline" onClick={onSetup}>Set up local AI</button>{onReader && <button className="button ghost" onClick={onReader}>Open Reader</button>}</>}</div></div></div>;
}

function SummaryView({ paper, busy, canSummarize, summarize, navigate, onSelect, expandedEvidence }) {
  const claims = revalidateSummaryClaims(paper.summary?.claims, paper.blocks);
  const { mode: sourceMode } = paperArticleSource(paper);
  return <div className="summary-view">
    <div className="section-heading"><div><h2>Paper summary</h2><p>Verify each claim against the original</p></div><button className="button blue" disabled={!!busy || !canSummarize} onClick={summarize}><Sparkles size={16} /> {paper.summary ? 'Regenerate' : 'Generate summary'}</button></div>
    {paper.summary ? <>
      {paper.summary.stale && <Notice tone="error">The source text changed after this summary was generated. Regenerate before relying on it.</Notice>}
      <p className="summary-evidence-note">AI-generated summary. Source links show where quotations appear. Verify research findings and the model’s interpretation against the original paper.</p>
      <div className="summary-panels">
        <article className="summary-card" data-view-scope="summarySource" tabIndex={0} aria-label="Source summary text" onMouseUp={event => onSelect(event.currentTarget, 'summarySource')}><small>{paper.summary.sourceLanguage}</small><Markdown annotations={viewAnnotations(paper, 'summarySource')}>{paper.summary.source}</Markdown></article>
        <article className="summary-card translated" data-view-scope="summaryTarget" tabIndex={0} aria-label="Translated summary text" onMouseUp={event => onSelect(event.currentTarget, 'summaryTarget')}><small>{paper.summary.targetLanguage}</small><Markdown annotations={viewAnnotations(paper, 'summaryTarget')}>{paper.summary.target}</Markdown></article>
      </div>
      {claims?.length ? <section className="source-links" aria-label="Check the Sources">
        <h3>Check the Sources</h3>
        {claims.map((claim, index) => {
          const key = JSON.stringify([sourceMode, index, claim.text]);
          return <details className="evidence-claim" key={key} open={expandedEvidence.has(key)}
            onToggle={event => { if (event.currentTarget.open) expandedEvidence.add(key); else expandedEvidence.delete(key); }}>
            <summary>Claim {index + 1} · {claim.sources.length ? `${claim.sources.length} exact source passage(s)` : 'No source link validated'}</summary>
            <p>{claim.text}</p>
            {claim.sources.length ? claim.sources.map((source, at) => <div key={`${source.paragraphID}-${at}`}><blockquote>{source.quote}</blockquote><button onClick={() => navigate(source.paragraphID, { revealSource: true, quote: source.quote })}>Read original block {source.paragraphID} →</button></div>) : <small>Check the original paper independently before treating this claim as evidence.</small>}
          </details>;
        })}
      </section> : <p className="summary-evidence-note">This saved summary has no verified source links.</p>}
    </> : <Empty title={paper.blocks.length ? 'No summary yet' : 'No readable text yet'} body={paper.blocks.length ? 'Generate a source and target language summary using your local model. Exact source quotations are linked only after validation.' : 'Use MinerU OCR from Paper or Original before summarizing this PDF.'} />}
  </div>;
}

function OverviewView({ paper, busy, canSummarize, summarize, navigate, onSelect, expandedEvidence, issues, onOriginal, onReader, translatedCount, paragraphCount }) {
  const entries = readingMap(paper.blocks);
  return <div className="content-column">
    {issues.length > 0 && <div className="quality-list"><h3>Extraction check · {issues.length} possible issue(s)</h3>{issues.slice(0, 20).map(issue => <button key={issue.id} onClick={() => navigate(issue.id)}>Review block {issue.id}: {issue.reason}</button>)}</div>}
    <section className="reading-guide">
      <div className="reading-guide-heading"><h2>Find your way into the paper.</h2><p>A map of detected sections with exact source excerpts. No model is used, and these passages are not an AI summary.</p></div>
      <div className="reading-guide-actions"><button className="button blue" disabled={!paragraphCount} onClick={onReader}>Start Reading</button><button className="button outline" onClick={onOriginal}>View Original</button><span>{translatedCount} / {paragraphCount} translated</span></div>
      {!entries.length && <p className="reading-guide-empty">{paragraphCount ? 'No suitable section passages were detected. Start in Reader and inspect the source directly.' : 'This document has no selectable text. You can still view its original pages; use MinerU/OCR to make scanned text readable by the analysis tools.'}</p>}
      <div className="reading-map">{entries.map(entry => <article key={entry.id}><div className="reading-map-title"><strong>{entry.title}</strong><button onClick={() => navigate(entry.paragraphID)}>Read paragraph {entry.paragraphID} →</button></div><p className="reading-map-question">{entry.question}</p><p className="reading-map-excerpt">{short(entry.excerpt, 360)}</p><small>SOURCE EXCERPT · {entry.sectionTitle}</small></article>)}</div>
      <p className="reading-guide-disclaimer">Missing sections are not invented. Headings and reading order depend on extraction; verify scientific claims against the source.</p>
    </section>
    <SummaryView paper={paper} busy={busy} canSummarize={canSummarize} summarize={summarize} navigate={navigate} onSelect={onSelect} expandedEvidence={expandedEvidence} />
  </div>;
}

function PaperPreview({ paper, displayMode, referenceIDs, onSelect }) {
  const host = useRef(null);
  const { mode: sourceMode, structured } = paperArticleSource(paper);
  const blocks = paper.blocks;
  const articleAnnotations = useMemo(() => [...(paper.viewHighlights || []), ...(paper.viewNotes || [])].filter(item =>
    item.scope === 'paperArticle' && item.displayMode === displayMode && item.sourceMode === sourceMode && !item.needsReview),
  [paper.viewHighlights, paper.viewNotes, displayMode, sourceMode]);
  useRichAnnotations(host, blocks, articleAnnotations);
  const passages = useMemo(() => blocks.map(block => {
    const sourceOnly = block.resource || referenceIDs.has(block.id);
    const translated = block.status === 'ok' && Boolean(block.translation || block.translationMarkdown);
    const unavailable = displayMode === 'translation' && !translated && !sourceOnly;
    return <section className="paper-preview-block" data-paper-block-id={block.id} key={block.id}>
      {(displayMode !== 'translation' || sourceOnly || unavailable) && <>
        <BlockPassage block={block} kind="source" scope="paper" structured={structured}
          className={unavailable ? 'paper-preview-source unavailable' : 'paper-preview-source'} data-paper-kind="source" />{'\n'}
      </>}
      {displayMode !== 'source' && !sourceOnly && (translated
        ? <><BlockPassage block={block} kind="translation" scope="paper" structured={structured}
          className="paper-preview-translation" data-paper-kind="translation" />{'\n'}</>
        : displayMode === 'bilingual' && <div className="paper-preview-translation unavailable" data-selection-ignore><p>Translation unavailable</p></div>)}
    </section>;
  }), [blocks, displayMode, referenceIDs, structured]);
  return <article ref={host} data-view-scope="paperArticle" className={`document-preview paper-mode-${displayMode}`} tabIndex={0} aria-label="Paper preview text"
    onMouseUp={event => onSelect(event.currentTarget, 'paper')}>
    {passages}
  </article>;
}

function LibraryView({ items, query, setQuery, loadPaper, setModal, busy, setLibraryEdit }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  async function openItem(id) {
    setError('');
    setOpening(true);
    try {
      if (await loadPaper(id)) setModal(current => current === 'library' ? '' : current);
      else setError('Finish the current task or retry the workspace save before opening another paper.');
    } catch (cause) {
      setError(cause.message);
    } finally { setOpening(false); }
  }
  return <>
    <p>Saved on this PC with each paper’s translations, notes, bookmarks, and reading position.</p>
    <input placeholder="Search titles and tags" value={query} onChange={event => setQuery(event.target.value)} />
    {items.map(item => <div className="library-entry" key={item.id}>
      <button className="modal-list-row" disabled={busy || opening} onClick={() => openItem(item.id)}><BookOpen size={17} /><span><b>{item.name}</b><small>{item.translatedCount ?? 0}/{item.blockCount} translated{item.lastOpened ? ` · Opened ${new Date(item.lastOpened).toLocaleDateString()}` : ''}{item.tags?.length ? ` · ${item.tags.join(', ')}` : ''}</small></span></button>
      <button className="icon-button" aria-label={`Edit label for ${item.name}`} onClick={() => { setLibraryEdit({ id: item.id, name: item.name, tags: (item.tags || []).join(', ') }); setModal('libraryLabel'); }}><Pencil size={16} /></button>
    </div>)}
    {!items.length && <p>{query.trim() ? 'No matching papers. Try another title or tag.' : 'No saved papers. Open a PDF or paste text to begin.'}</p>}
    {busy && <p>Finish or stop the current task before opening another paper.</p>}
    {error && <div role="alert"><Notice tone="error">{error}</Notice></div>}
  </>;
}

function SavedAnnotations({ paper, navigateBlockAnnotation, navigateView, navigatePdf, removeNote, removeHighlight, removeViewNote, removeViewHighlight, removePdfNote, removePdfHighlight }) {
  const notes = paper.blocks.flatMap(block => (block.notes || []).map(note => ({ block, note })));
  const highlights = paper.blocks.flatMap(block => [
    ...(block.highlights || []).map(highlight => ({ block, highlight, kind: 'source' })),
    ...(block.translationHighlights || []).map(highlight => ({ block, highlight, kind: 'translation' }))
  ]);
  const viewNotes = paper.viewNotes || [];
  const viewHighlights = paper.viewHighlights || [];
  const pdfNotes = paper.pdfNotes || [];
  const pdfHighlights = paper.pdfHighlights || [];
  if (!notes.length && !highlights.length && !viewNotes.length && !viewHighlights.length && !pdfNotes.length && !pdfHighlights.length) return null;
  return <div className="inspector-section saved-annotations"><small>SAVED ANNOTATIONS · {notes.length + highlights.length + viewNotes.length + viewHighlights.length + pdfNotes.length + pdfHighlights.length}</small>
    {notes.map(({ block, note }) => <div className="annotation-row" key={note.id}><button onClick={() => navigateBlockAnnotation(block.id, note, note.kind || 'source', 'note')}><b>{blockAnnotationScope(note) === 'paper' ? 'Paper' : 'Reader'} · Block {block.id}{note.needsReview || !validBlockAnchor(block, note, note.kind || 'source') ? ' · source changed, review needed' : ''}</b><span>{short(note.text, 90)}</span><small>{short(note.body, 110)}</small></button><button className="icon-button" aria-label={`Delete note ${note.id}`} onClick={() => removeNote(block.id, note.id)}><Trash2 size={14} /></button></div>)}
    {highlights.map(({ block, highlight, kind }, index) => <div className="annotation-row" key={`${block.id}-${highlight.offset}-${index}`}><button onClick={() => navigateBlockAnnotation(block.id, highlight, kind, 'highlight')}><b>{blockAnnotationScope(highlight) === 'paper' ? 'Paper' : 'Reader'} · Block {block.id} · {kind} · {highlight.color} highlight{highlight.needsReview || !validBlockAnchor(block, highlight, kind) ? ' · source changed, review needed' : ''}</b><span>{short(highlight.text, 90)}</span></button><button className="icon-button" aria-label={`Remove highlight ${block.id} ${index}`} onClick={() => removeHighlight(block.id, highlight, kind)}><Trash2 size={14} /></button></div>)}
    {viewNotes.map(note => <div className="annotation-row" key={note.id}><button onClick={() => navigateView(note)}><b>{markdownViewLabel(note.scope)}{validViewAnchor(paper, note) ? '' : ' · source changed, review needed'}</b><span>{short(note.text, 90)}</span><small>{short(note.body, 110)}</small></button><button className="icon-button" aria-label={`Delete view note ${note.id}`} onClick={() => removeViewNote(note.id)}><Trash2 size={14} /></button></div>)}
    {viewHighlights.map(highlight => <div className="annotation-row" key={highlight.id}><button onClick={() => navigateView(highlight)}><b>{markdownViewLabel(highlight.scope)} · {highlight.color}{validViewAnchor(paper, highlight) ? '' : ' · source changed, review needed'}</b><span>{short(highlight.text, 90)}</span></button><button className="icon-button" aria-label={`Remove view highlight ${highlight.id}`} onClick={() => removeViewHighlight(highlight.id)}><Trash2 size={14} /></button></div>)}
    {pdfNotes.map(note => <div className="annotation-row" key={note.id}><button onClick={() => navigatePdf(note)}><b>{pdfAnnotationScope(note) === 'paperPdf' ? 'Paper · exact PDF' : 'Original PDF'} · {pdfPageLabel(note)}{note.needsReview ? ' · source changed, review needed' : ''}</b><span>{short(note.quote ?? note.text, 90)}</span><small>{short(note.body, 110)}</small></button><button className="icon-button" aria-label={`Delete PDF note ${note.id}`} onClick={() => removePdfNote(note.id)}><Trash2 size={14} /></button></div>)}
    {pdfHighlights.map(highlight => <div className="annotation-row" key={highlight.id}><button onClick={() => navigatePdf(highlight)}><b>{pdfAnnotationScope(highlight) === 'paperPdf' ? 'Paper · exact PDF' : 'Original PDF'} · {pdfPageLabel(highlight)} · {highlight.color} highlight{highlight.needsReview ? ' · source changed, review needed' : ''}</b><span>{short(highlight.quote ?? highlight.text, 90)}</span></button><button className="icon-button" aria-label={`Remove PDF highlight ${highlight.id}`} onClick={() => removePdfHighlight(highlight.id)}><Trash2 size={14} /></button></div>)}
  </div>;
}

function ParagraphExplanation({ paper, activeBlock, language, setLanguage, result, onExplain, busy }) {
  const block = paper.blocks.find(item => item.id === activeBlock);
  if (!block || block.resource) return null;
  return <div className="inspector-section paragraph-explanation"><small>{block.heading ? 'HEADING EXPLANATION' : 'FULL PARAGRAPH EXPLANATION'} · BLOCK {block.id}</small><select aria-label="Explanation language" value={language} onChange={event => setLanguage(event.target.value)}>{languages.map(value => <option key={value}>{value}</option>)}</select><button className="inspector-link" disabled={!!busy} onClick={() => onExplain(block.id)}>{block.heading ? 'Explain heading' : 'Explain full paragraph'}</button>{result?.id === block.id && <p>{result.output}</p>}</div>;
}

function SelectionResults({ results }) {
  return <>{['translate', 'explain'].filter(kind => results?.[kind]).map(kind => <div className={`inspector-result ${kind}`} key={kind}><small>{kind === 'translate' ? 'TRANSLATION' : 'SIMPLE EXPLANATION'}</small><p>{results[kind]}</p></div>)}</>;
}

function HighlightControls({ activeColor, onAdd, onRemove, compact = false }) {
  return <div className={`highlight-controls ${compact ? 'compact' : ''}`}>{currentHighlightColors.map(color => <button key={color} className={`highlight ${color}${activeColor === color ? ' selected' : ''}`} title={`${highlightColorName(color)} highlight`} aria-label={`${highlightColorName(color)} highlight`} aria-pressed={activeColor === color} onClick={() => onAdd(color)}><Highlighter size={compact ? 14 : 16} /></button>)}{activeColor && <button className="remove-selection-highlight" onClick={onRemove}>Remove Highlight</button>}</div>;
}

function QuickSelection({ selection, results, busy, lookup, activeColor, quickTermOpen, termDraft, termSaving, setTermDraft, onTranslate, onExplain, onHighlight, onRemoveHighlight, onOpenTerm, onSaveTerm, onCancelTerm, onMore, onCancelTask, onClose }) {
  const quote = selection.quote ?? selection.text;
  return <div className="selection-toolbar" role="dialog" aria-label="Quick selection" onMouseDown={event => { if (!event.target.closest('input')) event.preventDefault(); }}>
    <div className="quick-selection-head"><strong>{short(quote, 150)}</strong><button aria-label="Close quick lookup" onClick={onClose}><X size={14} /></button></div>
    <div className="quick-selection-actions"><button disabled={!!busy} onClick={onTranslate}><Languages size={14} /> Translate</button><button disabled={!!busy} onClick={onExplain}><Sparkles size={14} /> Explain</button></div>
    {busy && <div className="quick-selection-busy"><span>{busy.label}</span><button onClick={onCancelTask}>Cancel</button></div>}
    <SelectionResults results={results} />
    {!busy && lookup?.error && <p className="selection-lookup-message error" role="alert">{lookup.error}</p>}
    {!busy && !lookup?.error && lookup?.status && <p className="selection-lookup-message">{lookup.status}</p>}
    <div className="quick-highlight-row"><span>Highlight</span><HighlightControls activeColor={activeColor} onAdd={onHighlight} onRemove={onRemoveHighlight} compact /></div>
    {quickTermOpen ? <div className="quick-term"><input aria-label="Preferred translation" placeholder="Preferred translation" value={termDraft} disabled={termSaving} onChange={event => setTermDraft(event.target.value)} /><div className="row"><button disabled={!termDraft.trim() || termSaving} onClick={onSaveTerm}>Save Term</button><button disabled={termSaving} onClick={onCancelTerm}>Cancel</button></div></div> : <div className="quick-selection-foot"><button disabled={termSaving || !canSaveTermSource(quote)} onClick={onOpenTerm}>Save Term…</button><button onClick={onMore}><MessageSquareText size={14} /> Notes & More</button></div>}
  </div>;
}

function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(null);
  const settingsRef = useRef(null);
  const settingsSaveChain = useRef(Promise.resolve());
  const modelRefreshId = useRef(0);
  const [appVersion, setAppVersion] = useState('');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateStatus, setUpdateStatus] = useState('');
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [glossary, setGlossary] = useState([]);
  const glossarySave = useRef(null);
  const [glossarySaving, setGlossarySaving] = useState(false);
  const [glossaryError, setGlossaryError] = useState('');
  const [library, setLibrary] = useState([]);
  const [paper, setPaper] = useState(null);
  const expandedEvidence = useMemo(() => new Set(), [paper?.id]);
  const paperRef = useRef(null);
  const [tab, setTab] = useState('Paper');
  const [displayMode, setDisplayMode] = useState('bilingual');
  const [modal, setModal] = useState('');
  const modalRef = useRef(null);
  const finishingOnboarding = useRef(false);
  const [onboardingFinishing, setOnboardingFinishing] = useState(false);
  const [onboardingSaveError, setOnboardingSaveError] = useState('');
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const onboardingBusyRef = useRef(false);
  const handleOnboardingBusy = useCallback(value => { onboardingBusyRef.current = value; setOnboardingBusy(value); }, []);
  const [paste, setPaste] = useState('');
  const [models, setModels] = useState([]);
  const [hardware, setHardware] = useState(null);
  const [mineruRuntime, setMineruRuntime] = useState(null);
  const [runningModels, setRunningModels] = useState([]);
  const [checkingHardware, setCheckingHardware] = useState(false);
  const [hardwareError, setHardwareError] = useState('');
  const hardwareCheckId = useRef(0);
  const [modelDownloadMessage, setModelDownloadMessage] = useState('');
  const [modelDownloadError, setModelDownloadError] = useState('');
  const [ollamaError, setOllamaError] = useState('');
  const [openAIState, setOpenAIState] = useState({ hasKey: false, consent: false, models: [], refreshing: false, saving: false, status: '', error: '' });
  const openAIStateRef = useRef(openAIState);
  openAIStateRef.current = openAIState;
  const openAIRefreshId = useRef(null);
  const [status, setStatus] = useState('Open a PDF or try the practice paper.');
  const [error, setError] = useState('');
  const [workspaceSave, setWorkspaceSave] = useState({ status: 'idle', error: null });
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [importElapsed, setImportElapsed] = useState(0);
  const [search, setSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryEdit, setLibraryEdit] = useState(null);
  const [glossarySearch, setGlossarySearch] = useState('');
  const [selection, setSelection] = useState(null);
  const [selectionResults, setSelectionResults] = useState({});
  const [selectionLookup, setSelectionLookup] = useState({ status: '', error: '' });
  const [explanationLanguage, setExplanationLanguage] = useState('English');
  const [noteDraft, setNoteDraft] = useState('');
  const [termDraft, setTermDraft] = useState('');
  const [quickTermOpen, setQuickTermOpen] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [compactInspector, setCompactInspector] = useState(() => window.matchMedia('(max-width: 1399px)').matches);
  const [sidebar, setSidebar] = useState(true);
  const [focus, setFocus] = useState(false);
  const focusRestore = useRef(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pdfNavigation, setPdfNavigation] = useState(null);
  const [viewNavigation, setViewNavigation] = useState(null);
  const [blockNavigation, setBlockNavigation] = useState(null);
  const [activeBlock, setActiveBlock] = useState(1);
  const [edit, setEdit] = useState(null);
  const [undo, setUndo] = useState([]);
  const [readingHistoryState, setReadingHistoryState] = useState({ back: 0, forward: 0 });
  const pendingUndoSnapshot = useRef(null);
  const noteEditingIdentity = useRef('');
  const [pullModel, setPullModel] = useState('');
  const [pullProgress, setPullProgress] = useState(null);
  const [pulling, setPulling] = useState(false);
  const [cancellingPull, setCancellingPull] = useState(false);
  const pullRef = useRef(false);
  const [setupProgress, setSetupProgress] = useState(null);
  const searchRef = useRef(null);
  const taskRef = useRef(null);
  const selectionRef = useRef(null);
  selectionRef.current = selection;
  const lookupCache = useRef(new Map());
  const translationQueueRef = useRef(null);
  const mineruPreflight = useRef(false);
  const saveQueue = useRef(null);
  const readingHistory = useRef(null);
  const readingRestoration = useRef(0);
  const readingGeneration = readingRestoration.current;
  const fileInputRef = useRef(null);
  const mainScrollRef = useRef(null);
  const scrollSaveTimer = useRef(null);
  const restoringScroll = useRef(false);
  const searchOrigin = useRef(null);
  const lastCommand = useRef({ name: '', at: 0 });
  const commandRef = useRef(null);

  if (!saveQueue.current) saveQueue.current = createPaperSaveQueue({
    save: snapshot => api.savePaper(snapshot),
    onState: next => setWorkspaceSave(next),
    onSaved: result => setLibrary(result)
  });
  if (!readingHistory.current) readingHistory.current = createReadingHistory(50);

  const commitPaper = (updater, { delay = 0, deferUndo = false, undoRange } = {}) => {
    const current = paperRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (next === current) return current;
    if (pendingUndoSnapshot.current && !deferUndo) {
      const entry = createUndoEntry(pendingUndoSnapshot.current, next, undoRange);
      pendingUndoSnapshot.current = null;
      if (entry) setUndo(previous => [...previous, entry].slice(-20));
    }
    paperRef.current = next; setPaper(next);
    if (next) saveQueue.current.schedule(next, delay);
    return next;
  };
  async function finishNoteEditing() {
    if (noteEditingIdentity.current && pendingUndoSnapshot.current) {
      const entry = createUndoEntry(pendingUndoSnapshot.current, paperRef.current);
      pendingUndoSnapshot.current = null;
      if (entry) setUndo(previous => [...previous, entry].slice(-20));
    }
    noteEditingIdentity.current = '';
    return saveQueue.current.flush();
  }
  async function retryPaperSave() {
    await saveQueue.current.retry();
  }
  const syncReadingHistory = () => {
    const snapshot = readingHistory.current.snapshot();
    setReadingHistoryState({ back: snapshot.back.length, forward: snapshot.forward.length });
  };
  const scrollKey = (surface = tab, page = pageNumber) => surface === 'Original' ? `Original:${page}` : surface;
  function currentReadingLocation() {
    const current = paperRef.current;
    if (!current) return null;
    const scrollByTab = { ...current.position?.scrollByTab };
    const key = scrollKey();
    scrollByTab[key] = mainScrollRef.current?.scrollTop || 0;
    const pdfHost = mainScrollRef.current?.querySelector('.pdf-continuous');
    const pdfPage = pdfPageElement(pdfHost, pageNumber);
    if (pdfPage) scrollByTab[pdfScrollKey(pdfHost.dataset.pdfScope, pageNumber)] = Math.max(0, pdfHost.scrollTop - pdfPage.offsetTop);
    let block = activeBlock;
    if (tab === 'Reader' && !search && mainScrollRef.current) {
      const top = mainScrollRef.current.getBoundingClientRect().top;
      const visible = [...mainScrollRef.current.querySelectorAll('.reader-list > .block')].find(element => element.getBoundingClientRect().bottom > top + 12);
      if (visible) block = Number(visible.id.replace('block-', ''));
    }
    return { paperId: current.id, sourceMode: paperArticleSource(current).mode, tab, displayMode, block,
      page: pageNumber, search, searchOrigin: searchOrigin.current, scrollByTab };
  }
  function recordReadingJump(isAlreadyAtDestination = () => false) {
    const location = currentReadingLocation();
    if (!location || isAlreadyAtDestination(location)) return false;
    void finishNoteEditing();
    clearTimeout(scrollSaveTimer.current);
    readingHistory.current.record(location);
    syncReadingHistory();
    commitPaper(current => ({ ...current, position: { ...current.position, block: location.block, page: location.page, tab: location.tab, displayMode: location.displayMode, scrollByTab: location.scrollByTab } }));
    return true;
  }
  function invalidateReadingScroll() {
    clearTimeout(scrollSaveTimer.current);
    restoringScroll.current = false;
    return ++readingRestoration.current;
  }
  function resetReadingHistory() {
    readingHistory.current.reset();
    invalidateReadingScroll();
    syncReadingHistory();
  }
  function canRestoreReadingLocation(location) {
    const current = paperRef.current;
    if (!current || location.paperId !== current.id) return false;
    return !location.sourceMode || location.sourceMode === paperArticleSource(current).mode || canSwitchReadingSource(current, location.sourceMode);
  }
  function restoreReadingLocation(location) {
    if (!location || location.paperId !== paperRef.current?.id) return;
    void finishNoteEditing();
    const generation = invalidateReadingScroll();
    restoringScroll.current = true;
    searchOrigin.current = location.searchOrigin ?? null;
    window.getSelection()?.removeAllRanges();
    setSelection(null); setSelectionResults({}); setPdfNavigation(null); setViewNavigation(null); setBlockNavigation(null);
    setTab(location.tab); setDisplayMode(location.displayMode); setActiveBlock(location.block); setPageNumber(location.page); setSearch(location.search);
    const sourceChanged = location.sourceMode && location.sourceMode !== paperArticleSource(paperRef.current).mode;
    if (sourceChanged) { setUndo([]); setEdit(null); setError(''); }
    commitPaper(current => ({
      ...(sourceChanged ? switchReadingSource(current, location.sourceMode, settingsRef.current) : current),
      position: { ...current.position, tab: location.tab, displayMode: location.displayMode, block: location.block,
        page: location.page, scrollByTab: { ...location.scrollByTab } }
    }));
    afterReadingLayout(mainScrollRef.current, () => {
      const current = paperRef.current;
      if (generation !== readingRestoration.current || current?.id !== location.paperId ||
          current.position?.tab !== location.tab || current.position?.displayMode !== location.displayMode) return;
      const key = scrollKey(location.tab, location.page);
      const saved = location.scrollByTab?.[key];
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = Number(saved || 0);
      if (saved == null && location.tab === 'Reader') document.getElementById(`block-${location.block}`)?.scrollIntoView({ block: 'start' });
      restoringScroll.current = false;
    });
  }
  function goBackInReading() {
    const destination = readingHistory.current.goBack(currentReadingLocation(), canRestoreReadingLocation);
    syncReadingHistory();
    restoreReadingLocation(destination);
  }
  function goForwardInReading() {
    const destination = readingHistory.current.goForward(currentReadingLocation(), canRestoreReadingLocation);
    syncReadingHistory();
    restoreReadingLocation(destination);
  }
  function navigateToTab(target) {
    if (!paperRef.current || target === tab) return;
    recordReadingJump();
    setTab(target);
  }
  function changeFacsimilePage(number) {
    setPageNumber(number);
    commitPaper(current => ({ ...current, position: { ...current.position, page: number } }));
  }
  function changePdfPage(scope, number, offset, manual) {
    if (paperRef.current?.id !== paper.id || readingGeneration !== readingRestoration.current) return;
    if (manual) {
      void finishNoteEditing();
      setPdfNavigation(null);
      setSelection(null);
    }
    setPageNumber(number);
    const key = pdfScrollKey(scope, number);
    commitPaper(current => {
      const position = current.position;
      if (position?.page === number && position.scrollByTab?.[key] === offset) return current;
      return { ...current, position: { ...position, page: number, scrollByTab: { ...position?.scrollByTab, [key]: offset } } };
    }, { delay: manual ? 0 : 250, deferUndo: !manual });
  }
  function selectPdf(anchor, scope) {
    return applyReadingSelection({ ...anchor, id: null, kind: 'source', scope });
  }
  function hideQuickSelectionOnScroll() {
    setSelection(current => current?.rect ? { ...current, rect: null } : current);
  }
  const loadPaper = async (item, { fromImport = false, token = null } = {}) => {
    if ((busy || taskRef.current) && !fromImport) { setError('Finish or stop the current task before opening another paper.'); return; }
    if (!await finishNoteEditing()) { setError('The current paper could not be saved. Retry before opening another paper.'); return; }
    let loaded = typeof item === 'string' ? await api.loadPaper(item) : item;
    if (token) requireActiveTask(token);
    if (!loaded) throw new Error('This saved paper could not be read. Its library entry was retained.');
    if (taskRef.current && !fromImport) return false;
    const previous = settingsRef.current;
    const hasTaskSettings = Boolean(loaded.taskSettings);
    // Workspaces saved before provider support contain local results.
    const restoredFromPaper = restorePaperSettings({ ...previous, aiProvider: 'ollama', translationStyleGuide: '' }, loaded.taskSettings);
    loaded = { ...loaded, paragraphExplanations: migrateExplanations(loaded, hasTaskSettings ? restoredFromPaper : null) };
    if (hasTaskSettings || previous.aiProvider === 'openai') {
      const restored = { ...(hasTaskSettings ? restoredFromPaper : previous), aiProvider: previous.aiProvider,
        openAITranslationModel: previous.openAITranslationModel, openAISummaryModel: previous.openAISummaryModel,
        openAIExplainModel: previous.openAIExplainModel, openAIQuickLookupModel: previous.openAIQuickLookupModel };
      loaded = { ...switchOutputSettings(loaded, restoredFromPaper, restored), taskSettings: snapshotPaperSettings(restored) };
      settingsRef.current = restored; setSettings(restored);
      if (previous?.ollamaBaseURL !== restored.ollamaBaseURL) { setModels([]); setOllamaError('Checking the restored local endpoint…'); refreshModels(restored); }
    }
    resetReadingHistory();
    paperRef.current = loaded; setPaper(loaded); setUndo([]); setTab(loaded.position?.tab || 'Paper'); setDisplayMode(loaded.position?.displayMode || 'bilingual'); setExplanationLanguage(languages.includes(loaded.explanationLanguage) ? loaded.explanationLanguage : 'English'); setInspector(loaded.inspectorOpen ?? inspector); setSelection(null); setPdfNavigation(null); setViewNavigation(null); setBlockNavigation(null); setSearch(''); setActiveBlock(loaded.position?.block || 1); setPageNumber(loaded.position?.page || 1);
    setStatus(loaded.extractionWarning || (hasTaskSettings ? `Opened ${loaded.name}.` : `Opened ${loaded.name}. This older paper has no saved task settings; check its languages and models before continuing.`));
    return true;
  };
  const updateBlock = (id, change) => commitPaper(current => ({ ...current, blocks: current.blocks.map(block => block.id === id ? { ...block, ...change } : block) }));
  const updateSettings = change => {
    const previous = settingsRef.current;
    const taskChanged = Object.keys(change).some(key => TASK_SETTING_KEYS.includes(key) && change[key] !== previous[key]);
    if (taskChanged && taskRef.current) cancelTask();
    const next = { ...previous, ...change };
    if (change.aiProvider !== undefined && change.aiProvider !== previous.aiProvider) {
      api.setOpenAIConsent(false).catch(() => {});
      setOpenAIState(current => ({ ...current, consent: false, status: change.aiProvider === 'openai' ? 'OpenAI is selected but paused until you allow this session.' : 'Using local Ollama.', error: '' }));
    }
    if (change.ollamaBaseURL !== undefined && change.ollamaBaseURL !== previous.ollamaBaseURL) {
      setModels([]); setRunningModels([]); setOllamaError('Refresh models to check this local endpoint.');
    }
    if (change.mineruExecutable !== undefined && change.mineruExecutable !== previous.mineruExecutable) setMineruRuntime(null);
    settingsRef.current = next; setSettings(next);
    if (paperRef.current && taskChanged) {
      commitPaper(current => ({ ...switchOutputSettings(current, previous, next), taskSettings: snapshotPaperSettings(next) }));
      setSelectionResults({});
      setUndo([]);
    }
  };
  const changeExplanationLanguage = language => {
    if (taskRef.current?.kind === 'selection') cancelTask();
    setSelectionResults({});
    setExplanationLanguage(language);
    if (paperRef.current) commitPaper(current => ({ ...current, explanationLanguage: language }));
  };
  function openOnboarding() {
    if (taskRef.current || pulling) { setError('Finish or cancel the current task before starting the setup guide.'); return; }
    setOnboardingSaveError(''); updateSettings({ onboardingPage: 0 }); setModal('onboarding');
  }
  async function finishOnboarding(action = 'done') {
    if (onboardingBusyRef.current || finishingOnboarding.current) return;
    finishingOnboarding.current = true; setOnboardingFinishing(true); setOnboardingSaveError('');
    try {
      updateSettings({ onboardingCompletedVersion: ONBOARDING_VERSION });
      const saved = settingsRef.current;
      settingsSaveChain.current = settingsSaveChain.current.catch(() => {}).then(() => api.saveSettings(saved));
      await settingsSaveChain.current;
      setModal(action === 'setup' ? 'setup' : '');
      if (action === 'openPdf') openFile();
      if (action === 'practice') loadPractice();
    } catch (cause) { setOnboardingSaveError(`Could not save setup progress: ${cause.message}`); }
    finally { finishingOnboarding.current = false; setOnboardingFinishing(false); }
  }
  function dismissModal() {
    if (modal === 'onboarding') { if (!onboardingBusyRef.current) finishOnboarding('skip'); return; }
    setModal('');
  }
  async function checkForUpdates(automatic = false) {
    if (!automatic) { setCheckingUpdates(true); setUpdateStatus('Checking Windows releases…'); }
    try {
      const result = await api.checkUpdates(automatic);
      if (result.status === 'available') setUpdateInfo(result);
      else if (!automatic) setUpdateInfo(null);
      if (!automatic) setUpdateStatus(result.status === 'available' ? `Windows ${result.latestVersion} is available.` : result.status === 'unpublished' ? 'No Windows release has been published yet.' : 'You have the latest published Windows version.');
    } catch (cause) { if (!automatic) setUpdateStatus(cause.message); }
    finally { if (!automatic) setCheckingUpdates(false); }
  }
  async function openUpdateRelease() {
    if (!updateInfo?.tag) return;
    try { await api.openUpdateRelease(updateInfo.tag); }
    catch (cause) { setError(cause.message); }
  }
  const changeDisplayMode = mode => {
    if (mode !== displayMode) invalidateReadingScroll();
    if (mode !== displayMode && selectionRef.current?.scope === 'paperArticle') {
      void finishNoteEditing();
      window.getSelection()?.removeAllRanges();
      setSelection(null); setSelectionResults({});
    }
    setDisplayMode(mode);
    commitPaper(current => ({ ...current, position: { ...current.position, displayMode: mode } }));
  };
  const rememberUndo = () => { pendingUndoSnapshot.current = paperRef.current; };
  function undoLastChange() {
    const entry = undo.at(-1);
    if (!entry) return;
    if (entry.type === 'structure' && taskRef.current) { setError('Finish or stop the current task before undoing a source edit.'); return; }
    noteEditingIdentity.current = '';
    const restored = commitPaper(current => applyUndoEntry(current, entry));
    if (entry.type === 'structure') {
      resetStructureNavigation();
      setActiveBlock(restored.position?.block || 1);
    } else setNoteDraft(findSelectionNote(restored, selectionRef.current)?.body || '');
    setUndo(previous => previous.slice(0, -1));
  }
  const restoreMainScroll = () => {
    const generation = readingRestoration.current;
    let cancelled = false;
    restoringScroll.current = true;
    afterReadingLayout(mainScrollRef.current, () => {
      if (cancelled || generation !== readingRestoration.current) return;
      const key = tab === 'Original' ? `Original:${pageNumber}` : tab;
      const saved = paperRef.current?.position?.scrollByTab?.[key];
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = Number(saved || 0);
      if (saved == null && tab === 'Reader') document.getElementById(`block-${activeBlock}`)?.scrollIntoView({ block: 'start' });
      restoringScroll.current = false;
    });
    return () => { cancelled = true; };
  };
  const saveMainScroll = () => {
    if (restoringScroll.current || !paperRef.current) return;
    const generation = readingRestoration.current;
    setSelection(current => current?.rect ? { ...current, rect: null } : current);
    clearTimeout(scrollSaveTimer.current);
    const id = paperRef.current.id;
    const key = tab === 'Original' ? `Original:${pageNumber}` : tab;
    const offset = mainScrollRef.current?.scrollTop || 0;
    scrollSaveTimer.current = setTimeout(() => {
      if (paperRef.current?.id !== id || generation !== readingRestoration.current) return;
      const host = mainScrollRef.current;
      const top = host?.getBoundingClientRect().top || 0;
      const visible = tab === 'Reader' && !search ? [...host.querySelectorAll('.reader-list > .block')].find(element => element.getBoundingClientRect().bottom > top + 12) : null;
      const block = visible ? Number(visible.id.replace('block-', '')) : paperRef.current.position?.block;
      if (visible) setActiveBlock(block);
      commitPaper(current => ({ ...current, position: { ...current.position, block, scrollByTab: { ...current.position?.scrollByTab, [key]: offset } } }));
    }, 350);
  };
  const changeSearch = value => {
    if (!search && value) searchOrigin.current = mainScrollRef.current?.scrollTop || 0;
    setSearch(value);
    if (search && !value && searchOrigin.current !== null) {
      const offset = searchOrigin.current;
      const generation = readingRestoration.current;
      searchOrigin.current = null;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (generation === readingRestoration.current && mainScrollRef.current) mainScrollRef.current.scrollTop = offset;
      }));
    }
  };
  const toggleFocus = () => {
    if (focus) {
      setSidebar(focusRestore.current?.sidebar ?? true);
      setInspector(focusRestore.current?.inspector ?? true);
      focusRestore.current = null;
      setFocus(false);
    } else {
      focusRestore.current = { sidebar, inspector };
      setSidebar(false);
      setInspector(false);
      setFocus(true);
    }
  };
  const refreshModels = async config => {
    const requestId = ++modelRefreshId.current;
    const isCurrent = () => requestId === modelRefreshId.current && settingsRef.current?.ollamaBaseURL === config.ollamaBaseURL;
    try { const values = await api.listModels(config.ollamaBaseURL); if (isCurrent()) { setModels(values); setOllamaError(''); } return values; }
    catch (err) { if (isCurrent()) { setModels([]); setOllamaError(err.message); } return []; }
  };
  async function refreshOpenAIKeyStatus() {
    try {
      const result = await api.openAIKeyStatus();
      setOpenAIState(current => ({ ...current, hasKey: result.hasKey, error: '' }));
    } catch (cause) { setOpenAIState(current => ({ ...current, hasKey: false, error: cause.message })); }
  }
  async function saveOpenAIKey(value) {
    setOpenAIState(current => ({ ...current, saving: true, error: '', status: '' }));
    try {
      await api.saveOpenAIKey(value);
      setOpenAIState(current => ({ ...current, hasKey: true, consent: false, models: [], saving: false, status: 'Key saved with Windows credential encryption. Refresh models to check access.', error: '' }));
      return true;
    } catch (cause) { setOpenAIState(current => ({ ...current, saving: false, error: cause.message })); return false; }
  }
  async function removeOpenAIKey() {
    setOpenAIState(current => ({ ...current, saving: true, error: '', status: '' }));
    try {
      await api.removeOpenAIKey();
      setOpenAIState(current => ({ ...current, hasKey: false, consent: false, models: [], saving: false, status: 'API key removed.', error: '' }));
    } catch (cause) { setOpenAIState(current => ({ ...current, saving: false, error: cause.message })); }
  }
  async function setOpenAIConsent(enabled) {
    if (!enabled && settingsRef.current?.aiProvider === 'openai' && taskRef.current) cancelTask();
    setOpenAIState(current => ({ ...current, consent: enabled, error: '' }));
    try {
      const consent = await api.setOpenAIConsent(enabled);
      setOpenAIState(current => ({ ...current, consent, error: '', status: consent ? 'OpenAI text access is enabled for this app session.' : 'OpenAI text access is paused.' }));
    } catch (cause) { setOpenAIState(current => ({ ...current, consent: false, error: cause.message })); }
  }
  async function refreshOpenAIModels() {
    if (openAIState.refreshing) return;
    const requestId = crypto.randomUUID();
    const previous = openAIRefreshId.current;
    openAIRefreshId.current = requestId;
    if (previous) api.cancelOpenAI(previous).catch(() => {});
    setOpenAIState(current => ({ ...current, refreshing: true, error: '', status: 'Fetching model IDs only; no paper text is sent.' }));
    try {
      const values = await api.listOpenAIModels(requestId);
      if (openAIRefreshId.current === requestId) setOpenAIState(current => ({ ...current, models: values, refreshing: false, status: `Found ${values.length} model IDs. Choose a text model that supports the Responses API.`, error: '' }));
    } catch (cause) {
      if (openAIRefreshId.current === requestId) setOpenAIState(current => ({ ...current, refreshing: false, status: 'Could not fetch models.', error: cause.message }));
    } finally { if (openAIRefreshId.current === requestId) openAIRefreshId.current = null; }
  }
  function useRecommendedModel(model) {
    if (pullRef.current || taskRef.current) return;
    try { updateSettings(modelSettingsPatch(settingsRef.current, model, models)); setModelDownloadError(''); setModelDownloadMessage(`${model.title} is selected for ${model.role === 'translation' ? 'translation' : 'summary, explanation and quick lookup'}.`); }
    catch (cause) { setModelDownloadError(cause.message); }
  }
  async function downloadModel(requestedModel = pullModel.trim() || 'translategemma:4b', recommendation = null) {
    if (pullRef.current || taskRef.current) return;
    pullRef.current = true; setPulling(true); setCancellingPull(false); setPullProgress(null); setError(''); setModelDownloadMessage(''); setModelDownloadError('');
    const config = settingsRef.current;
    const paperId = paperRef.current?.id;
    try {
      await api.pullModel({ baseURL: config.ollamaBaseURL, model: requestedModel });
      const available = await refreshModels(config);
      let message = 'Model downloaded. Choose its task in Settings.';
      if (recommendation && settingsRef.current.ollamaBaseURL === config.ollamaBaseURL && paperRef.current?.id === paperId) {
        updateSettings(modelSettingsPatch(settingsRef.current, recommendation, available));
        message = `${recommendation.title} downloaded and selected for ${recommendation.role === 'translation' ? 'translation' : 'summary, explanation and quick lookup'}.`;
      }
      setPullProgress(null); setStatus(message); setModelDownloadMessage(message);
    }
    catch (cause) { if (/cancel|abort/i.test(cause.message)) { setStatus('Model download cancelled.'); setModelDownloadMessage('Model download cancelled.'); setPullProgress(null); } else { setError(cause.message); setModelDownloadError(cause.message); } }
    finally { pullRef.current = false; setPulling(false); setCancellingPull(false); }
  }
  async function cancelModelDownload() {
    setCancellingPull(true);
    try { await api.cancelPullModel(); } catch (cause) { setError(cause.message); setModelDownloadError(cause.message); setCancellingPull(false); }
  }
  async function checkHardware() {
    const request = ++hardwareCheckId.current, config = settingsRef.current;
    setCheckingHardware(true); setHardwareError('');
    const results = await Promise.allSettled([api.graphicsStatus(), api.mineruRuntime(config.mineruExecutable), api.runningModels(config.ollamaBaseURL)]);
    if (request !== hardwareCheckId.current) return;
    if (results[0].status === 'fulfilled') setHardware(results[0].value);
    if (config.mineruExecutable === settingsRef.current.mineruExecutable && results[1].status === 'fulfilled') setMineruRuntime(results[1].value);
    if (config.ollamaBaseURL === settingsRef.current.ollamaBaseURL) setRunningModels(results[2].status === 'fulfilled' ? results[2].value : []);
    setHardwareError(results.filter(result => result.status === 'rejected').map(result => result.reason.message).join(' ')); setCheckingHardware(false);
  }
  useEffect(() => {
    api.bootstrap().then(async data => {
      settingsRef.current = data.settings; setSettings(data.settings); setAppVersion(data.version); setGlossary(data.glossary); setLibrary(data.library);
      if (data.library.length) {
        try { await loadPaper(data.library.some(item => item.id === data.lastPaperId) ? data.lastPaperId : data.library[0].id); }
        catch (cause) { setError(cause.message); }
      }
      const currentSettings = settingsRef.current;
      setReady(true);
      if (!(currentSettings.onboardingCompletedVersion >= ONBOARDING_VERSION)) setModal('onboarding');
      refreshOpenAIKeyStatus();
      refreshModels(currentSettings);
      api.graphicsStatus().then(setHardware).catch(() => {});
      api.mineruRuntime(currentSettings.mineruExecutable).then(setMineruRuntime).catch(() => {});
    }).catch(err => setError(err.message));
    const off = api.onProgress(data => {
      if (data.kind === 'setup') setSetupProgress(data);
      else if (data.kind === 'model') setPullProgress(data);
      else if (data.kind === 'mineru' && data.requestId && data.requestId === taskRef.current?.mineruRequest) {
        const message = data.status || 'MinerU is processing the PDF…';
        setStatus(message);
        setPendingImport(current => current ? { ...current, stage: mineruImportStage(message) } : current);
      }
    });
    return off;
  }, []);
  useEffect(() => {
    if (!pendingImport) { setImportElapsed(0); return undefined; }
    const update = () => setImportElapsed(Math.max(0, Math.floor((Date.now() - pendingImport.startedAt) / 1000)));
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [pendingImport?.startedAt]);
  useEffect(() => { if (ready && settings) settingsSaveChain.current = settingsSaveChain.current.catch(() => {}).then(() => api.saveSettings(settings)).catch(err => setError(err.message)); }, [settings, ready]);
  useEffect(() => {
    const dialog = modalRef.current;
    if (!modal || !dialog) return;
    const previous = document.activeElement;
    const focusable = () => [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
      .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'));
    const trap = event => {
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1), active = document.activeElement;
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (!items.includes(active) || event.shiftKey && active === first || !event.shiftKey && active === last) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    dialog.focus();
    document.addEventListener('keydown', trap, true);
    return () => {
      document.removeEventListener('keydown', trap, true);
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, [modal]);
  useEffect(() => {
    const id = paper?.id;
    if (!id) return;
    saveQueue.current.flush().then(async saved => {
      if (!saved || paperRef.current?.id !== id) return;
      const opened = await api.markPaperOpened(id);
      if (paperRef.current?.id !== id) return;
      setLibrary(current => {
        const item = current.find(entry => entry.id === id);
        return item ? [{ ...item, lastOpened: opened.lastOpened }, ...current.filter(entry => entry.id !== id)] : current;
      });
    }).catch(cause => setError(cause.message));
  }, [paper?.id]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1399px)');
    const update = event => setCompactInspector(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (taskRef.current?.kind === 'selection' && taskRef.current.selectionKey !== selectionIdentity(selection)) cancelTask(); }, [selectionIdentity(selection)]);
  useEffect(() => { setQuickTermOpen(false); setTermDraft(''); setSelectionLookup({ status: '', error: '' }); }, [selectionIdentity(selection)]);
  useEffect(() => {
    if (!ready || settings?.autoCheckUpdates === false) return;
    checkForUpdates(true);
    const timer = setInterval(() => checkForUpdates(true), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [ready, settings?.autoCheckUpdates]);
  useEffect(() => { if (modal === 'glossary') setGlossaryError(''); }, [modal]);
  useEffect(() => { if (paperRef.current && paperRef.current.position?.tab !== tab) commitPaper(current => ({ ...current, position: { ...current.position, tab } })); }, [tab]);
  useEffect(() => { if (paperRef.current && !focus && paperRef.current.inspectorOpen !== inspector) commitPaper(current => ({ ...current, inspectorOpen: inspector })); }, [inspector, paper?.id, focus]);
  useEffect(() => {
    void finishNoteEditing();
    setSelection(null); setSelectionResults({});
  }, [tab, paper?.id]);
  useEffect(() => {
    if (!viewNavigation || !paper || tab !== markdownViewTab(viewNavigation.scope)) return;
    const article = viewNavigation.scope === 'paperArticle';
    if (article && (displayMode !== viewNavigation.displayMode || paperArticleSource(paper).mode !== viewNavigation.sourceMode)) return;
    const surface = document.querySelector(`[data-view-scope="${viewNavigation.scope}"]`);
    const host = article ? surface : surface?.querySelector('[data-markdown-host]');
    const rendered = domText(host, true);
    const source = viewText(paper, viewNavigation.scope);
    const { text, scope } = viewNavigation;
    const offset = markdownAnnotationOffset(rendered, viewNavigation, source);
    const range = offset === null || !validViewAnchor(paper, viewNavigation) ? null : textRangeAt(host, offset, text.length, true);
    if (!range) { markViewAnchorForReview(viewNavigation); setViewNavigation(null); return; }
    const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
    const generation = readingRestoration.current;
    afterReadingLayout(host, () => {
      if (generation === readingRestoration.current && selected.rangeCount && selected.getRangeAt(0) === range) {
        range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
      }
    });
    const captured = { text, offset, context: rendered };
    const position = article ? {
      ...selectionOffsets(captured, null, paperArticleSource(paper)), displayMode: viewNavigation.displayMode, sourceMode: viewNavigation.sourceMode
    } : textSelectionOffsets(captured, source, source);
    applyReadingSelection({ id: null, kind: article ? viewNavigation.kind || 'source' : scope === 'summarySource' ? 'source' : 'translation',
      text, scope, ...position, rect: null, context: rendered.slice(Math.max(0, offset - 300), offset + text.length + 300) });
    setInspector(true); setViewNavigation(null);
  }, [viewNavigation?.requestId, tab, displayMode, paper?.id]);
  const command = name => {
    if (name === 'dismiss') { dismissModal(); setSelection(null); return; }
    if (modal === 'onboarding' && name !== 'onboarding') return;
    const now = performance.now();
    if (lastCommand.current.name === name && now - lastCommand.current.at < 150) return;
    lastCommand.current = { name, at: now };
    if (name === 'openPdf') { if (!busy) openFile(); }
    else if (name === 'library') setModal('library');
    else if (name === 'glossary') setModal('glossary');
    else if (name === 'summary') { if (paper) setTab('Summary'); }
    else if (name === 'find') { if (paper) { setTab('Reader'); setTimeout(() => searchRef.current?.focus(), 0); } }
    else if (name === 'primaryTask' && paper && !busy) {
      if (tab === 'Summary') { if (!paper.summary || paper.summary.stale) summarize(); }
      else if (tab === 'Full Translation') { if (fullTranslationNeedsWork) fullTranslation(); }
      else if (paper.blocks.some(block => block.status !== 'ok')) translateBlocks(paper.blocks.map(block => block.id));
    }
    else if (name === 'generateSummary') { if (paper && !busy) { setTab('Summary'); summarize(); } }
    else if (name === 'generateFullTranslation') { if (paper && !busy) { setTab('Full Translation'); fullTranslation(); } }
    else if (name === 'export') { if (paper && !busy) setModal('export'); }
    else if (name === 'inspector') { if (focus) toggleFocus(); setInspector(true); }
    else if (name === 'translateSelection') { if (selection && !busy) runSelection('translate'); }
    else if (name === 'explainSelection') { if (selection && !busy) runSelection('explain'); }
    else if (name === 'highlightSelection') { if (selection) addHighlight('amber'); }
    else if (name === 'undo') { if (paper && undo.length) undoLastChange(); }
    else if (name === 'readingBack') goBackInReading();
    else if (name === 'readingForward') goForwardInReading();
    else if (name === 'settings') setModal('settings');
    else if (name === 'setup') setModal('setup');
    else if (name === 'onboarding') openOnboarding();
    else if (name === 'checkUpdates') checkForUpdates(false);
  };
  commandRef.current = command;
  useEffect(() => {
    const offCommand = api.onCommand(name => commandRef.current?.(name));
    const key = event => {
      if (event.key === 'Escape') { commandRef.current?.('dismiss'); }
      if (!event.ctrlKey || event.repeat) return;
      const letter = event.key.toLowerCase();
      const name = event.shiftKey && !event.altKey ? ({ l: 'library', e: 'export', i: 'inspector', t: 'translateSelection', h: 'highlightSelection' })[letter]
        : event.altKey && !event.shiftKey ? ({ e: 'explainSelection' })[letter]
        : !event.shiftKey && !event.altKey ? ({ o: 'openPdf', l: 'library', f: 'find', '1': 'summary', enter: 'primaryTask', '[': 'readingBack', ']': 'readingForward' })[letter] : null;
      if (name) { event.preventDefault(); commandRef.current?.(name); }
    };
    window.addEventListener('keydown', key); return () => { offCommand(); window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => api.onPrepareClose(async () => {
    try { await glossarySave.current; }
    catch { api.closeCancelled(); return; }
    const saved = await finishNoteEditing();
    if (saved) api.closeReady();
    else {
      setError('PaperBridge kept this window open because the latest paper changes could not be saved. Retry the save, then close again.');
      api.closeCancelled();
    }
  }), []);
  useEffect(() => paper && !viewNavigation && !blockNavigation ? restoreMainScroll() : undefined, [tab, paper?.id]);
  useEffect(() => {
    const targetTab = blockNavigation?.scope === 'paper' ? 'Paper' : 'Reader';
    if (!blockNavigation || !paper || tab !== targetTab) return;
    let cancelled = false;
    afterReadingLayout(mainScrollRef.current, () => {
      if (cancelled || paperRef.current?.id !== paper.id) return;
      const request = blockNavigation;
      const block = paperRef.current.blocks.find(item => item.id === request.blockId);
      const root = request.scope === 'paper'
        ? document.querySelector(`[data-paper-block-id="${request.blockId}"] [data-paper-kind="${request.kind}"]`)
        : document.querySelector(`[data-block-id="${request.blockId}"][data-kind="${request.kind}"]`);
      const rich = Boolean(root?.querySelector('[data-markdown-host]'));
      const rendered = domText(root, rich);
      const source = anchorText(block, request.kind);
      const markdown = rich && blockMarkdown(block, request.kind);
      const at = markdownAnnotationOffset(rendered, request, source);
      const range = block && validBlockAnchor(block, request, request.kind, markdown) && at !== null ? textRangeAt(root, at, request.text.length, rich) : null;
      if (!range) {
        if (request.recordType === 'evidence') {
          root?.scrollIntoView({ block: 'start' });
          setBlockNavigation(null);
          return;
        }
        commitPaper(current => ({ ...current, blocks: current.blocks.map(item => item.id !== request.blockId ? item : request.recordType === 'note'
          ? { ...item, notes: (item.notes || []).map(note => note.id === request.id ? { ...note, needsReview: true } : note) }
          : { ...item, [request.kind === 'translation' ? 'translationHighlights' : 'highlights']: (item[request.kind === 'translation' ? 'translationHighlights' : 'highlights'] || []).map(highlight => (request.id ? highlight.id === request.id : highlight.text === request.text && highlight.offset === request.offset && highlight.color === request.color && blockAnnotationScope(highlight) === request.scope) ? { ...highlight, needsReview: true } : highlight) }) }));
        setError(`The saved ${request.scope === 'paper' ? 'Paper' : 'Reader'} text no longer matches this block. The annotation was kept for review.`);
        setBlockNavigation(null);
        return;
      }
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      const host = mainScrollRef.current;
      if (host && request.recordType === 'evidence') {
        const quote = range.getBoundingClientRect();
        const viewport = host.getBoundingClientRect();
        const top = root.closest('.block')?.getBoundingClientRect().top ?? quote.top;
        host.scrollTop += Math.max(top, quote.top - Math.max(0, (host.clientHeight - quote.height) / 2)) - viewport.top;
      } else range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
      const captured = { text: request.text, offset: at, context: rendered };
      applyReadingSelection({ id: block.id, kind: request.kind, text: request.text, ...textSelectionOffsets(captured, source, markdown),
        scope: request.scope, rect: null, context: rendered.slice(Math.max(0, at - 300), at + request.text.length + 300) });
      if (request.recordType !== 'evidence') setInspector(true);
      setBlockNavigation(null);
    });
    return () => { cancelled = true; };
  }, [blockNavigation?.requestId, tab, displayMode, paper?.id]);
  useEffect(() => () => clearTimeout(scrollSaveTimer.current), []);

  async function openFile() {
    if (taskRef.current) return;
    let imported;
    try { imported = await api.importPdf(); }
    catch (err) { setError(err.message); return; }
    if (!imported || taskRef.current) return;
    const token = startPdfImport(imported.name, 'Preparing the selected PDF');
    try {
      requireActiveTask(token);
      await ingestPdf(imported, token);
    } catch (err) { if (!token.cancelled) setError(`Could not import ${imported.name}: ${err.message}`); } finally { endTask(token); }
  }
  async function dropPdf(event) {
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    if (modal) return;
    if (taskRef.current) { setError('Finish or stop the current task before opening another paper.'); return; }
    const file = files.find(item => /\.pdf$/i.test(item.name));
    if (!file) { setError('Drop a PDF file to open it.'); return; }
    const token = startPdfImport(file.name, 'Reading the selected file');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      requireActiveTask(token);
      const imported = await api.importPdfBytes({ name: file.name, bytes });
      requireActiveTask(token);
      setPendingImport(current => current ? { ...current, name: imported.name, stage: 'Preparing the selected PDF' } : current);
      await ingestPdf(imported, token);
    } catch (err) { if (!token.cancelled) setError(`Could not import ${file.name}: ${err.message}`); } finally { endTask(token); }
  }
  function startPdfImport(name, stage) {
    const token = startTask(`Opening ${name}…`);
    token.kind = 'pdfImport';
    setPendingImport({ name, startedAt: Date.now(), stage });
    return token;
  }
  async function extractMineruForTask(id, executable, backend, token) {
    const requestId = crypto.randomUUID();
    token.mineruRequest = requestId;
    try {
      const markdown = await api.extractMineru({ id, executable, backend, requestId });
      requireActiveTask(token);
      return markdown;
    } finally { token.mineruRequest = null; }
  }
  async function ingestPdf(imported, token) {
    requireActiveTask(token);
    if (imported.existing) { await loadPaper(imported.existing, { fromImport: true, token }); return; }
    const config = settingsRef.current;
    const mode = config.pdfExtractionMode || 'mineruPreferred';
    let mineruMarkdown = '';
    let mineruBlocks = null;
    const warnings = [];
    if (mode !== 'pdfOnly') {
      try {
        setPendingImport(current => current ? { ...current, stage: 'Checking MinerU availability' } : current);
        const mineru = await api.mineruStatus(config.mineruExecutable);
        requireActiveTask(token);
        if (!mineru.compatible) throw new Error(mineru.reason || 'No compatible MinerU installation was detected. Open Local AI setup.');
        setBusy({ label: 'MinerU is reconstructing the paper…' });
        setPendingImport(current => current ? { ...current, stage: 'MinerU is processing the PDF' } : current);
        mineruMarkdown = await extractMineruForTask(imported.id, mineru.executable, config.mineruBackend, token);
        mineruBlocks = readableMineruBlocks(mineruMarkdown);
      } catch (cause) {
        requireActiveTask(token);
        if (mode === 'mineruOnly') throw cause;
        warnings.push(`MinerU failed: ${cause.message} Using the original PDF and any selectable text.`);
      }
    }
    let pdf;
    let pdfBlocks = [];
    let pageCount = 0;
    try {
      setBusy({ label: 'Reading PDF text layer…' });
      setPendingImport(current => current ? { ...current, stage: 'Reading selectable PDF text' } : current);
      pdf = await openPdf(imported.bytes);
      requireActiveTask(token);
      pageCount = pdf.numPages;
      pdfBlocks = await extractPdf(pdf, (done, total) => {
        setProgress({ done, total });
        setPendingImport(current => current ? { ...current, stage: `Reading selectable PDF text · ${done} of ${total}` } : current);
      }, () => requireActiveTask(token));
      if (!pdfBlocks.length && !mineruBlocks) warnings.push('No selectable text found. The exact original PDF is available. Use MinerU for OCR.');
    } catch (cause) {
      requireActiveTask(token);
      if (!pdf && !mineruBlocks) throw cause;
      warnings.push(`The selectable PDF text could not be read: ${cause.message} The original file is preserved.`);
    } finally { await pdf?.loadingTask.destroy().catch(() => {}); }
    const blocks = mineruBlocks || pdfBlocks;
    const extractionWarning = warnings.join(' ');
    if (!await finishNoteEditing()) throw new Error('Retry the current paper save before opening another paper.');
    requireActiveTask(token);
    const document = {
      id: imported.id, name: imported.name, type: 'pdf', createdAt: new Date().toISOString(),
      blocks, pdfBlocks, mineruBlocks, mineruMarkdown: mineruBlocks ? mineruMarkdown : '', sourceMode: mineruBlocks ? 'mineru' : 'pdf',
      extraction: mineruBlocks ? 'MinerU' : 'PDF.js', extractionWarning,
      tags: [], summary: null, connectedTranslation: '', taskSettings: snapshotPaperSettings(config), explanationLanguage: 'English',
      paragraphExplanations: {}, inspectorOpen: inspector, position: { block: 1, page: 1, tab: 'Paper', displayMode: 'bilingual' }
    };
    resetReadingHistory();
    setUndo([]); commitPaper(document); setTab('Paper'); setDisplayMode('bilingual'); setExplanationLanguage('English'); setActiveBlock(1); setPageNumber(1); setSearch('');
    setStatus(extractionWarning || `Extracted ${blocks.length} blocks${pageCount ? ` from ${pageCount} pages` : ''}. Compare uncertain passages with Original PDF.`);
  }
  async function importText(text, name = 'Pasted Text') {
    if (!text.trim() || taskRef.current) return;
    const token = startTask('Preparing pasted text…');
    try {
    const id = await sha256(text.trim());
    const existing = await api.loadPaper(id);
    requireActiveTask(token);
    if (existing) await loadPaper(existing, { fromImport: true, token });
    else { resetReadingHistory(); setUndo([]); commitPaper({ id, name, type: 'text', createdAt: new Date().toISOString(), blocks: blocksFromText(text), tags: [], summary: null, connectedTranslation: '', taskSettings: snapshotPaperSettings(settingsRef.current), explanationLanguage: 'English', paragraphExplanations: {}, inspectorOpen: inspector, position: { block: 1, page: 1, tab: 'Paper' }, extraction: 'Pasted text' }); setTab('Paper'); setExplanationLanguage('English'); setActiveBlock(1); setPageNumber(1); setSearch(''); }
    setModal(''); setPaste('');
    } catch (cause) { if (!token.cancelled) setError(cause.message); } finally { endTask(token); }
  }
  function loadPractice() {
    if (paperRef.current) { setStatus('The practice paper is available from the empty workspace. Your open paper remains unchanged.'); return; }
    importText(sample.join('\n\n'), 'Welcome to PaperBridge (practice sample)').catch(cause => setError(cause.message));
  }
  function startTask(label) { const token = { cancelled: false, ids: new Set(), paperId: paperRef.current?.id }; taskRef.current = token; setBusy({ label }); setProgress(null); setError(''); return token; }
  function requireActiveTask(token) { if (token.cancelled || taskRef.current !== token) throw new Error('Cancelled'); }
  function endTask(token) {
    if (taskRef.current !== token) return;
    taskRef.current = null;
    if (token.kind === 'pdfImport') setPendingImport(null);
    setBusy(null);
    setProgress(null);
  }
  async function generate(model, prompt, system, token, format) {
    requireActiveTask(token);
    const requestId = crypto.randomUUID(); token.ids.add(requestId);
    try {
      let answer;
      if (settingsRef.current.aiProvider === 'openai') {
        if (!openAIStateRef.current.consent) throw new Error('Open Settings > Models to allow sending text to OpenAI for this session. Nothing was sent.');
        if (!openAIStateRef.current.hasKey) throw new Error('Save an OpenAI API key in Settings > Models.');
        if (!String(model || '').trim()) throw new Error('Choose an OpenAI model for this task in Settings > Models.');
        answer = await api.generateOpenAI({ model, prompt: omitInlineImageData(prompt), system: omitInlineImageData(system), requestId });
      } else answer = await api.generate({ baseURL: settingsRef.current.ollamaBaseURL, model, prompt, system, requestId, format });
      requireActiveTask(token); return answer;
    }
    finally { token.ids.delete(requestId); }
  }
  function cancelTask() {
    const token = taskRef.current;
    if (!token) return;
    token.cancelled = true;
    if (token.kind === 'bundleExport') {
      token.cancelRender?.();
      setStatus('Stopping page export…');
      return;
    }
    for (const id of token.ids) { api.cancel(id).catch(() => {}); api.cancelOpenAI(id).catch(() => {}); }
    api.cancelMineru().catch(() => {}); setPendingImport(null); taskRef.current = null; setBusy(null); setProgress(null);
    if (token.kind === 'selection') setSelectionLookup({ status: 'Quick lookup cancelled.', error: '' });
    setStatus('Task cancelled. Completed work was saved.');
  }
  function matchingTerms(text, from = settings.sourceLanguage, to = settings.targetLanguage) {
    return matchingGlossaryTerms(glossary, text, from, to);
  }
  async function translateBlocks(ids, { sharedFull = false } = {}) {
    if (!paperRef.current || busy || taskRef.current) return;
    const token = startTask('Translating paragraphs…');
    const references = referenceBlockIds(paperRef.current.blocks);
    const eligible = new Set(translationRangeIds(paperRef.current.blocks, ids, references));
    const queue = paperRef.current.blocks.filter(block => eligible.has(block.id));
    if (!queue.length) {
      if (sharedFull) commitPaper(withSharedMarkdownTranslation);
      setStatus(sharedFull ? 'Using completed Reader translations for the full paper.' : 'This range is already complete.');
      endTask(token);
      return;
    }
    function recordTranslation(id, change) {
      commitPaper(current => {
        const next = { ...current, blocks: current.blocks.map(block => block.id === id ? { ...block, ...change } : block) };
        const syncDraft = sharedFull || (current.connectedShared && !current.connectedStale && usesSharedMarkdown(current));
        return syncDraft ? withSharedMarkdownTranslation(next) : next;
      });
    }
    translationQueueRef.current = { token, queue, next: 0 };
    try {
      const config = settingsRef.current;
      const translationModel = activeAIModel(config, 'translation');
      const setupMessage = config.sourceLanguage === config.targetLanguage ? '' : openAISetupMessage(config, openAIStateRef.current.consent, openAIStateRef.current.hasKey, 'translation');
      if (setupMessage) throw new Error(setupMessage);
      if (config.aiProvider !== 'openai' && config.sourceLanguage !== config.targetLanguage && !models.includes(translationModel)) throw new Error(`Install ${translationModel} in Ollama first.`);
      for (let index = 0; index < queue.length; index++) {
        if (token.cancelled) break;
        const block = queue[index];
        translationQueueRef.current.next = index + 1;
        setBusy({ label: `Translating block ${block.id} · ${index + 1} of ${queue.length}` }); setProgress({ done: index, total: queue.length });
        try {
          const protectedBlock = block.sourceMarkdown ? protectMarkdown(block.sourceMarkdown) : null;
          let output = block.sourceMarkdown || block.text;
          if (config.sourceLanguage !== config.targetLanguage) {
            const parts = chunkText(protectedBlock?.text || block.text, Number(config.maxParagraphChars) || 1800);
            const translated = [];
            for (const part of parts) translated.push(await generate(translationModel, protectedBlock ? markdownTranslationPrompt(part, config.sourceLanguage, config.targetLanguage, matchingTerms(part)) : translationPrompt(part, config.sourceLanguage, config.targetLanguage, matchingTerms(part)), translationInstructions(config, config.targetLanguage, paperRef.current.name, translationSystem(config.targetLanguage)), token));
            output = protectedBlock ? restoreMarkdown(translated.join('\n'), protectedBlock.tokens) : translated.join(' ');
          }
          if (!token.cancelled) recordTranslation(block.id, { translation: output, translationMarkdown: protectedBlock ? output : null, status: 'ok', error: '' });
        } catch (err) { if (token.cancelled) break; if (config.aiProvider === 'openai' && isGlobalOpenAIError(err.message)) throw err; recordTranslation(block.id, { status: 'failed', error: err.message }); }
        setProgress({ done: index + 1, total: queue.length });
      }
      if (!token.cancelled) {
        if (sharedFull) {
          const remaining = translationRangeIds(paperRef.current.blocks, null, references).length;
          setStatus(remaining ? `Full translation saved with ${remaining} unfinished block(s). Original text is retained in those positions.`
            : 'Structure-preserving full translation saved. Reader and the full draft share the same translations.');
        } else setStatus(`Translation pass finished. ${paperRef.current.blocks.filter(block => block.status === 'ok' && !block.resource && !references.has(block.id)).length} blocks saved.`);
      }
    } catch (err) { setError(err.message); } finally { if (translationQueueRef.current?.token === token) translationQueueRef.current = null; endTask(token); }
  }
  function prioritizeSection(ids) {
    const active = translationQueueRef.current;
    if (!active || active.token.cancelled) return;
    const remaining = active.queue.splice(active.next);
    const priority = new Set(ids);
    active.queue.push(...remaining.filter(block => priority.has(block.id)), ...remaining.filter(block => !priority.has(block.id)));
    setStatus('Current section will run after the block in progress. Completed translations are retained.');
  }
  async function runSelection(kind) {
    if (!selection || busy || taskRef.current) return;
    const quote = selection.quote ?? selection.text;
    const block = paperRef.current.blocks.find(item => item.id === selection.id);
    const fullContext = isPdfScope(selection.scope) || selection.renderedAnchor ? selection.context || '' : (selection.kind === 'translation' ? block?.translation : block?.text) || selection.context || '';
    const config = settingsRef.current;
    const model = activeAIModel(config, 'quickLookup');
    const from = selection.kind === 'translation' ? config.targetLanguage : config.sourceLanguage;
    const to = selection.kind === 'translation' ? config.sourceLanguage : config.targetLanguage;
    const sourceContext = omitInlineImageData(fullContext);
    const context = selectionContext(sourceContext, quote, kind === 'translate' ? 600 : 2400);
    const terms = kind === 'translate' ? matchingTerms(quote, from, to) : [];
    const selectedKey = selectionIdentity(selection);
    const cacheKey = JSON.stringify([paperRef.current.id, kind, selectionTranslationCacheVersion, selectedKey, quote, fullContext, from, to, model, aiCacheNamespace(config), explanationLanguage, terms]);
    if (lookupCache.current.has(cacheKey)) { setSelectionResults(current => ({ ...current, [kind]: lookupCache.current.get(cacheKey) })); setSelectionLookup({ status: 'Using cached quick lookup.', error: '' }); return; }
    setSelectionLookup({ status: '', error: '' });
    const token = startTask(kind === 'translate' ? 'Translating selection…' : 'Explaining selection…');
    token.kind = 'selection'; token.selectionKey = selectedKey;
    try {
      let output = quote;
      if (kind === 'translate' && from !== to) {
        const withContext = context.includes(quote) && spansCompleteSentences(quote, sourceContext);
        const strict = strictSelectionTranslationPrompt(quote, from, to, terms);
        const prompt = withContext ? selectionTranslationPrompt(quote, context, from, to, terms) : strict;
        const system = translationInstructions(config, to, paperRef.current.name, selectionTranslationSystem(to));
        output = await generate(model, prompt, system, token);
        // Only a contextual local request has a distinct, non-billable fallback.
        if (withContext && config.aiProvider !== 'openai' && isLikelyOverexpandedSelection(output, quote)) {
          setBusy({ label: 'Refining exact selection…' });
          output = await generate(model, strict, system, token);
        }
        if (isLikelyOverexpandedSelection(output, quote)) throw new Error('The model expanded the selection instead of translating it. Retry with another model.');
      } else if (kind === 'explain') {
        output = await generate(model, explainPrompt(quote, context, explanationLanguage), 'You are a patient academic explainer. Explain accurately and simply.', token);
      }
      if (!token.cancelled && selectionIdentity(selectionRef.current) === selectedKey) { lookupCache.current.set(cacheKey, output); setSelectionResults(current => ({ ...current, [kind]: output })); setSelectionLookup({ status: kind === 'translate' ? 'Selection translated.' : 'Selection explained.', error: '' }); }
    } catch (err) { if (!token.cancelled) { setSelectionLookup({ status: '', error: err.message }); setError(err.message); } } finally { endTask(token); }
  }
  async function reextractAsNew() {
    if (paper?.type !== 'pdf' || busy || taskRef.current) return;
    setModal('');
    const token = startPdfImport(`${paper.name} (new extraction)`, 'Preparing an independent PDF copy');
    try { await ingestPdf(await api.copyPdfAsNew({ id: paper.id, name: paper.name }), token); }
    catch (cause) { if (!token.cancelled) setError(cause.message); }
    finally { endTask(token); }
  }
  async function explainBlock(id) {
    const block = paperRef.current?.blocks.find(item => item.id === id);
    if (!block || busy || taskRef.current) return;
    const token = startTask(`Explaining block ${id}…`);
    try {
      const output = await generate(activeAIModel(settingsRef.current, 'explanation'), explainPrompt(block.text, block.text, explanationLanguage), 'Explain this whole academic paragraph accurately and simply.', token);
      if (!token.cancelled) {
        const settingsKey = explanationKey(id, explanationLanguage, settings);
        const result = { id, language: explanationLanguage, source: block.text, output, settingsKey };
        commitPaper(current => ({ ...current, paragraphExplanations: { ...current.paragraphExplanations, [settingsKey]: result } }));
        setInspector(true);
      }
    } catch (cause) { if (!token.cancelled) setError(cause.message); } finally { endTask(token); }
  }
  async function summarize() {
    const current = paperRef.current;
    if (!current || busy || taskRef.current) return;
    const source = summarySourceBlocks(current.blocks);
    if (!source.length) { setError('No readable body text to summarize. For a scanned PDF, use MinerU OCR first.'); return; }
    const token = startTask('Summarizing paper…');
    try {
      const config = settingsRef.current;
      const summaryModel = activeAIModel(config, 'summary');
      const translationModel = activeAIModel(config, 'translation');
      const sameLanguage = config.sourceLanguage === config.targetLanguage;
      const roles = sameLanguage ? ['summary'] : ['summary', 'translation'];
      if (config.aiProvider === 'openai') {
        for (const role of roles) {
          const setupMessage = openAISetupMessage(config, openAIStateRef.current.consent, openAIStateRef.current.hasKey, role);
          if (setupMessage) throw new Error(setupMessage);
        }
      } else {
        const available = await api.listModels(config.ollamaBaseURL);
        requireActiveTask(token);
        for (const role of roles) {
          const model = activeAIModel(config, role);
          if (!available.includes(model)) throw new Error(`Install ${model || `a ${role} model`} in Ollama first.`);
        }
      }

      const batches = summarySourceBatches(source);
      const system = 'You are a careful academic paper assistant. Return only the requested JSON.';
      let claims = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        setBusy({ label: `Summarizing part ${i + 1} of ${batches.length}` }); setProgress({ done: i, total: batches.length + 1 });
        const response = await generate(summaryModel, summaryPrompt(batch, config.sourceLanguage), system, token, 'json');
        const partial = parseSummaryClaims(response, batch);
        const candidates = summarySourceCandidates(response, batch);
        for (const [index, claim] of partial.entries()) {
          if (claim.sources.length) continue;
          const excerpts = batch.filter(block => candidates[index]?.includes(block.id));
          for (const { id, text } of excerpts) {
            const answer = await generate(summaryModel, summaryQuotePrompt(claim.text, id, text), 'Select only an exact supporting quote from the supplied passage, or return NONE.', token);
            const quote = answer.trim().replace(/^["“‘]|["”’]$/g, '');
            if (quote.length >= 20 && quote.length <= 500 && text.includes(quote)) {
              claim.sources = [{ paragraphID: id, quote }];
              break;
            }
          }
        }
        claims.push(...partial);
        if (claims.length > 6) {
          setBusy({ label: `Consolidating claims through part ${i + 1} of ${batches.length}` });
          const response = await generate(summaryModel, mergeSummaryPrompt(claims, config.sourceLanguage), system, token, 'json');
          claims = parseSummaryClaims(response, source, claims.flatMap(claim => claim.sources));
          if (!claims.length) throw new Error('The summary model returned no usable consolidated claims; the saved summary was not replaced.');
        }
        setProgress({ done: i + 1, total: batches.length + 1 });
      }
      if (!claims.length) throw new Error('The summary model returned no usable claims; the saved summary was not replaced.');
      const sourceSummary = claimsMarkdown(claims);
      let targetSummary = sourceSummary;
      if (!sameLanguage) {
        const instructions = translationInstructions(config, config.targetLanguage, current.name, translationSystem(config.targetLanguage));
        const translations = [];
        for (const [index, claim] of claims.entries()) {
          setBusy({ label: `Translating summary claim ${index + 1} of ${claims.length}` });
          const { text, tokens } = protectMarkdown(claim.text);
          const prompt = translationPrompt(text, config.sourceLanguage, config.targetLanguage, matchingTerms(text, config.sourceLanguage, config.targetLanguage));
          const answer = await generate(translationModel, prompt, instructions, token);
          if (!answer.trim()) throw new Error('The summary translation was empty; the saved summary was not replaced.');
          translations.push({ text: restoreMarkdown(answer.trim(), tokens) });
        }
        targetSummary = claimsMarkdown(translations);
      }
      requireActiveTask(token);
      commitPaper(paper => ({ ...paper, summary: { source: sourceSummary, target: targetSummary, claims, sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage } }));
      setStatus('Summary saved. Only exact-match source quotations are linked.');
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function fullTranslation(force = false) {
    if (!paperRef.current || busy || taskRef.current) return;
    if (!paperRef.current.blocks.some(block => !block.heading && !block.resource)) { setError('No readable text to translate. Use MinerU OCR first.'); return; }
    if (usesSharedMarkdown(paperRef.current)) return translateBlocks(null, { sharedFull: true });
    const token = startTask('Translating full paper…');
    try {
      const config = settingsRef.current;
      const translationModel = activeAIModel(config, 'translation');
      const current = paperRef.current;
      if (!force && current.connectedTranslation && !current.connectedStale && !pendingConnectedBatches(current).length) {
        setStatus('Using the saved connected full translation.');
        return;
      }
      const saveDraft = batches => commitPaper(paper => ({
        ...paper, connectedBlocks: [...batches],
        connectedTranslation: batches.map(batch => batch.output).join('\n\n'),
        connectedBatchVersion, connectedShared: false, connectedStale: false
      }));
      if (config.sourceLanguage === config.targetLanguage) {
        const source = current.blocks.map(block => block.sourceMarkdown || block.text).join('\n\n');
        saveDraft([{ kind: 'original', source, output: source, status: 'ok' }]);
        setStatus('Source and target languages match. The full draft uses the original text.');
        return;
      }
      const previous = !force && !current.connectedStale && current.connectedBatchVersion === connectedBatchVersion
        ? current.connectedBlocks : [];
      const batches = planConnectedBatches(current.blocks).map((batch, index) => {
        const saved = previous?.[index];
        if (saved?.kind === batch.kind && saved.source === batch.source && saved.status === 'ok' && saved.output) return saved;
        return { ...batch, output: batch.source, status: batch.kind === 'original' ? 'ok' : 'pending' };
      });
      const translationCount = batches.filter(batch => batch.kind === 'translation').length;
      let done = batches.filter(batch => batch.kind === 'translation' && batch.status === 'ok').length;
      if (done === translationCount) {
        saveDraft(batches);
        setStatus('Connected full-paper translation saved.');
        return;
      }
      const setupMessage = openAISetupMessage(config, openAIStateRef.current.consent, openAIStateRef.current.hasKey, 'translation');
      if (setupMessage) throw new Error(setupMessage);
      if (config.aiProvider !== 'openai' && !models.includes(translationModel)) throw new Error(`Install ${translationModel} in Ollama first.`);
      setProgress({ done, total: translationCount });
      for (const [index, batch] of batches.entries()) {
        if (batch.status === 'ok') continue;
        requireActiveTask(token);
        setBusy({ label: `Translating full paper · batch ${done + 1} of ${translationCount}` });
        try {
          const protectedExcerpt = protectMarkdown(batch.source);
          const prompt = connectedTranslationPrompt(protectedExcerpt.text, config.sourceLanguage, config.targetLanguage, matchingTerms(protectedExcerpt.text));
          const answer = await generate(translationModel, prompt, translationInstructions(config, config.targetLanguage, current.name, translationSystem(config.targetLanguage)), token);
          const output = restoreConnectedExcerpt(answer, protectedExcerpt.tokens);
          batches[index] = { ...batch, output, status: 'ok' };
        } catch (cause) {
          if (token.cancelled) return;
          if (config.aiProvider === 'openai' && isGlobalOpenAIError(cause.message)) throw cause;
          batches[index] = { ...batch, status: 'failed', error: cause.message };
        }
        saveDraft(batches);
        setProgress({ done: ++done, total: translationCount });
      }
      const failures = batches.filter(batch => batch.status === 'failed').length;
      setStatus(failures ? `Connected full-paper translation saved. ${failures} failed batch(es) retain the original text.`
        : 'Connected full-paper translation saved.');
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function runMineru() {
    if (!paper || paper.type !== 'pdf' || busy || mineruPreflight.current) return;
    const hasMineruWork = blocks => blocks?.some(block => block.status === 'ok' || block.bookmark || block.highlights?.length || block.notes?.length);
    const hasArticleWork = (current, mode) => [current.viewNotes, current.viewHighlights].some(items =>
      items?.some(item => item.scope === 'paperArticle' && item.sourceMode === mode));
    if ((paper.sourceMode === 'mineru' && (hasMineruWork(paper.blocks) || paper.summary || paper.connectedTranslation)) ||
        hasMineruWork(paper.mineruBlocks) || hasArticleWork(paper, 'mineru')) {
      setError('This MinerU reader already contains saved work. Export it before parsing the PDF again.');
      return;
    }
    let runtime;
    mineruPreflight.current = true;
    try { runtime = await api.mineruStatus(settings.mineruExecutable); }
    catch (cause) { setError(`MinerU detection failed: ${cause.message}`); return; }
    finally { mineruPreflight.current = false; }
    if (paperRef.current?.id !== paper.id || taskRef.current) return;
    if (!runtime.compatible) { setStatus('MinerU OCR is not ready. Install it in Local AI setup, then parse this PDF again.'); setModal('setup'); return; }
    const token = startTask('MinerU is extracting structure…');
    try {
      const markdown = await extractMineruForTask(paper.id, runtime.executable, settings.mineruBackend, token);
      const blocks = readableMineruBlocks(markdown);
      resetReadingHistory();
      commitPaper(current => {
        const hasUserWork = current.summary || current.connectedTranslation || hasMineruWork(current.blocks) ||
          hasArticleWork(current, paperArticleSource(current).mode);
        return { ...current, mineruMarkdown: markdown, mineruBlocks: blocks, pdfBlocks: current.pdfBlocks || current.blocks, blocks: hasUserWork ? current.blocks : blocks, extractionWarning: '', extraction: hasUserWork ? current.extraction : 'MinerU', sourceMode: hasUserWork ? (current.sourceMode || 'pdf') : 'mineru' };
      });
      setStatus(`MinerU structure ready: ${blocks.length} blocks. You can switch Reader source without discarding either version.`);
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  function canSwitchReadingSource(current, mode) {
    if (taskRef.current) { setError('Finish or stop the current task before switching the reading source.'); return false; }
    if (current.type === 'pdf' && ['pdf', 'mineru'].includes(mode) && Array.isArray(current[`${mode}Blocks`])) return true;
    setError('The requested reading source is no longer available for this paper.');
    return false;
  }
  function switchSourceMode(mode) {
    const current = paperRef.current;
    if (!current || paperArticleSource(current).mode === mode || !canSwitchReadingSource(current, mode)) return false;
    recordReadingJump();
    invalidateReadingScroll();
    commitPaper(current => ({ ...switchReadingSource(current, mode, settingsRef.current), position: { ...current.position, block: 1 } }));
    searchOrigin.current = null;
    window.getSelection()?.removeAllRanges();
    setUndo([]); setEdit(null); setSelection(null); setSelectionResults({}); setSearch('');
    setPdfNavigation(null); setViewNavigation(null); setBlockNavigation(null);
    setActiveBlock(1);
    setError('');
    setStatus(`Reader source changed to ${mode === 'mineru' ? 'MinerU' : 'PDF text'}. The other version remains saved.`);
    return true;
  }
  function openPdfReader() {
    const current = paperRef.current;
    if (current?.mineruBlocks?.length && paperArticleSource(current).mode !== 'mineru') {
      if (switchSourceMode('mineru')) setTab('Reader');
    } else navigateToTab('Reader');
  }
  async function exportMarkdown(kind) {
    if (!paper) return;
    const document = markdownDocuments(paper).find(item => item.kind === kind);
    if (!document) return;
    try { const destination = await api.exportMarkdown({ name: `${paper.name.replace(/\.pdf$/i, '')}-${kind}`, content: document.content }); if (destination) setStatus(`Exported ${destination}`); }
    catch (err) { setError(err.message); }
    setModal('');
  }
  async function exportBundle() {
    if (!paper || taskRef.current) return;
    const token = startTask('Exporting portable Markdown bundle…');
    token.kind = 'bundleExport';
    try {
      const result = await api.exportBundle({
        paper: { id: paper.id, name: paper.name, type: paper.type, sourceMode: paper.sourceMode, facsimile: pdfFacsimile },
        documents: markdownDocuments(paper)
      });
      if (!result) return;
      setModal('');
      let pageImages = 0;
      let missingPages = 0;
      if (result.originalPdf) {
        setBusy({ label: 'Exporting portable PDF page images…' });
        const destination = { id: paper.id, folder: result.folder };
        let pdf;
        try {
          pdf = await openPdf(await api.readPdf(paper.id));
          const limit = Math.min(pdf.numPages, result.maximumPreviewPages);
          for (let pageNumber = 1; pageNumber <= limit && !token.cancelled; pageNumber++) {
            setProgress({ done: pageNumber - 1, total: limit });
            let image;
            try {
              const page = await pdf.getPage(pageNumber);
              if (token.cancelled) break;
              const base = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: Math.min(1.5, 1800 / Math.max(base.width, base.height)) });
              const canvas = document.createElement('canvas');
              canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
              const render = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
              token.cancelRender = () => render.cancel();
              await render.promise;
              if (!token.cancelled) image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            } catch {
              // A damaged page does not prevent exporting the other pages and exact PDF.
            } finally {
              token.cancelRender = null;
            }
            if (token.cancelled) break;
            if (image) {
              const bytes = new Uint8Array(await image.arrayBuffer());
              if (token.cancelled) break;
              await api.exportBundlePage({ ...destination, pageNumber, bytes });
              pageImages++;
            } else missingPages++;
            setProgress({ done: pageNumber, total: limit });
          }
        } finally {
          try { await api.finishBundle({ ...destination, pageCount: pdf?.numPages || 0, stopped: token.cancelled }); }
          finally { await pdf?.loadingTask.destroy(); }
        }
      }
      const missingAssets = result.missingAssetPaths?.length;
      setStatus(`Exported ${result.documents} Markdown files, ${result.assets} asset(s), ${pageImages} PDF page image(s)${token.cancelled ? ' (page export stopped)' : missingPages ? ` (${missingPages} unavailable)` : ''}${result.originalPdf ? ', and original PDF' : ''} to ${result.folder}${missingAssets ? `. ${missingAssets} referenced local asset(s) could not be included.` : ''}`);
    } catch (cause) { setError(`Bundle export incomplete: ${cause.message}`); }
    finally { endTask(token); setModal(''); }
  }
  async function clearSavedData() {
    if (taskRef.current) return;
    try {
      if (!await finishNoteEditing()) throw new Error('Retry the failed paper save before removing local data.');
      await settingsSaveChain.current;
      await glossarySave.current?.catch(() => {});
      openAIRefreshId.current = null;
      setOpenAIState(current => ({ ...current, consent: false, refreshing: false, models: [], status: '', error: '' }));
      await api.clearData();
      const data = await api.bootstrap();
      resetReadingHistory();
      paperRef.current = null; setPaper(null); setLibrary([]); setGlossary([]); settingsRef.current = data.settings; setSettings(data.settings);
      setSelection(null); setSearch(''); setUndo([]); setTab('Paper'); setActiveBlock(1); setPageNumber(1); setDisplayMode('bilingual'); setExplanationLanguage('English');
      setModal(''); setStatus('Saved PaperBridge workspaces were removed. Original PDF copies were kept.');
    } catch (cause) { setError(`Could not clear saved data: ${cause.message}`); }
  }
  async function saveLibraryLabel() {
    if (!libraryEdit?.name.trim()) return;
    try {
      const saved = await api.loadPaper(libraryEdit.id);
      if (!saved) throw new Error('This paper could not be loaded.');
      const label = libraryLabel(libraryEdit.name, libraryEdit.tags);
      if (paperRef.current?.id === saved.id) {
        commitPaper(current => ({ ...current, ...label }));
        if (!await saveQueue.current.flush()) throw new Error('Could not save the library label. Retry the workspace save.');
      } else setLibrary(await api.savePaper({ ...saved, ...label }));
      setModal('library'); setLibraryEdit(null);
    } catch (cause) { setError(cause.message); }
  }
  function captureSelection() {
    const selected = window.getSelection();
    const range = selected.rangeCount ? selected.getRangeAt(0) : null;
    if (!range) return;
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const element = start?.closest('[data-block-id]');
    const rich = Boolean(element?.querySelector('[data-markdown-host]'));
    const captured = domRangeIn(element, range, rich);
    if (!captured) return;
    const block = paperRef.current?.blocks.find(item => item.id === Number(element.dataset.blockId));
    const kind = element.dataset.kind || 'source';
    const source = anchorText(block, kind);
    const { text, rect } = captured;
    const nextSelection = { id: block?.id ?? null, kind, text, ...textSelectionOffsets(captured, source, rich && blockMarkdown(block, kind)), scope: 'reader', rect,
      context: captured.context.slice(Math.max(0, captured.offset - 300), captured.offset + text.length + 300) };
    return applyReadingSelection(nextSelection);
  }
  function addHighlight(color) {
    if (!selection) return;
    if (isPdfScope(selection.scope)) {
      if (!validPdfSelection(selection)) { setError('Select exact text in the original PDF before highlighting.'); return; }
      const saved = paper.pdfHighlights || [];
      const matching = saved.filter(item => highlightMatchesSelection(item, selection));
      if (matching.length === 1 && matching[0].color === color && matching[0].quote === selection.quote) { setStatus('This highlight already uses that color.'); return; }
      rememberUndo();
      const item = { ...(matching[0] || {}), id: matching[0]?.id || crypto.randomUUID(), scope: selection.scope,
        page: selection.page, offset: selection.offset, text: selection.text, quote: selection.quote,
        ...(selection.anchors && { anchors: storedPdfAnchors(selection) }), color };
      commitPaper(current => ({ ...current, pdfHighlights: [...saved.filter(entry => !highlightMatchesSelection(entry, selection)), item] }));
      const action = !matching.length ? 'saved' : matching[0].color === color ? 'updated' : 'color updated';
      setStatus(`PDF highlight ${action} in ${selection.scope === 'paperPdf' ? 'Paper' : 'Original'}.`);
      return;
    }
    if (isMarkdownView(selection.scope)) {
      if (!validNoteSelection(paper, selection)) { setError('This selection cannot be anchored exactly in the saved document.'); return; }
      const saved = paper.viewHighlights || [];
      const matching = saved.filter(item => highlightMatchesSelection(item, selection));
      if (matching.length === 1 && matching[0].color === color) { setStatus('This highlight already uses that color.'); return; }
      rememberUndo();
      const item = { ...(matching[0] || {}), id: matching[0]?.id || crypto.randomUUID(), scope: selection.scope, text: selection.text, offset: selection.offset, displayOffset: selection.displayOffset,
        ...((selection.renderedAnchor || matching[0]?.renderedAnchor) && { renderedAnchor: selection.renderedAnchor }),
        ...(selection.scope === 'paperArticle' && { displayMode: selection.displayMode, sourceMode: selection.sourceMode, kind: selection.kind }), color };
      commitPaper(current => ({ ...current, viewHighlights: [...saved.filter(entry => !highlightMatchesSelection(entry, selection)), item] }));
      setStatus(matching.length ? 'Highlight color updated.' : 'Highlight saved in the annotation list.');
      return;
    }
    const block = paper.blocks.find(item => item.id === selection.id);
    const key = selection.kind === 'translation' ? 'translationHighlights' : 'highlights';
    const source = anchorText(block, selection.kind);
    if (!['reader', 'paper'].includes(selection.scope) || !block || !validTextSelection(selection, source, blockMarkdown(block, selection.kind))) { setError('This exact selection cannot be anchored to one source block.'); return; }
    const highlights = block[key] || [];
    const matching = highlights.filter(item => highlightMatchesSelection(item, selection));
    if (matching.length === 1 && matching[0].color === color) { setStatus('This highlight already uses that color.'); return; }
    rememberUndo();
    const item = { ...(matching[0] || {}), id: matching[0]?.id || crypto.randomUUID(), scope: selection.scope, text: selection.text, offset: selection.offset, displayOffset: selection.displayOffset,
      ...((selection.renderedAnchor || matching[0]?.renderedAnchor) && { renderedAnchor: selection.renderedAnchor }), color };
    updateBlock(block.id, { [key]: [...highlights.filter(entry => !highlightMatchesSelection(entry, selection)), item] });
    setStatus(matching.length ? 'Highlight color updated.' : 'Highlight saved.');
  }
  function removeSelectionHighlight() {
    if (!paper || !selection || !selectionHighlights(paper, selection).length) return;
    rememberUndo();
    if (isPdfScope(selection.scope)) commitPaper(current => ({ ...current, pdfHighlights: (current.pdfHighlights || []).filter(item => !highlightMatchesSelection(item, selection)) }));
    else if (isMarkdownView(selection.scope)) commitPaper(current => ({ ...current, viewHighlights: (current.viewHighlights || []).filter(item => !highlightMatchesSelection(item, selection)) }));
    else {
      const block = paper.blocks.find(item => item.id === selection.id);
      const key = selection.kind === 'translation' ? 'translationHighlights' : 'highlights';
      updateBlock(block.id, { [key]: (block[key] || []).filter(item => !highlightMatchesSelection(item, selection)) });
    }
    setStatus('Highlight removed; its note was kept.');
  }
  function updateNote(body, sourceIdentity) {
    const currentPaper = paperRef.current;
    const currentSelection = selectionRef.current;
    if (!currentPaper || !sameNoteSelection(currentPaper.id, currentSelection, sourceIdentity)) return;
    if (!validNoteSelection(currentPaper, currentSelection)) {
      setError('This note needs an exact selection in the current saved document.');
      return;
    }
    const next = applySelectionNote(currentPaper, currentSelection, body);
    setNoteDraft(body);
    if (next === currentPaper) return;
    const identity = noteSelectionIdentity(currentPaper.id, currentSelection);
    if (noteEditingIdentity.current !== identity) {
      noteEditingIdentity.current = identity;
      rememberUndo();
    }
    commitPaper(next, { delay: 350, deferUndo: true });
  }
  async function saveNote() {
    if (!selection) return;
    const saved = await finishNoteEditing();
    setStatus(saved ? 'Note saved on this PC.' : 'The note is still in memory. Retry the failed save.');
  }
  function removeNote(blockId, noteId) { const block = paper.blocks.find(item => item.id === blockId); if (!block) return; rememberUndo(); updateBlock(blockId, { notes: (block.notes || []).filter(note => note.id !== noteId) }); }
  function removeHighlight(blockId, highlight, kind = 'source') { const block = paper.blocks.find(item => item.id === blockId); if (!block) return; const key = kind === 'translation' ? 'translationHighlights' : 'highlights'; rememberUndo(); updateBlock(blockId, { [key]: (block[key] || []).filter(item => item !== highlight) }); }
  function removeViewNote(id) { rememberUndo(); commitPaper(current => ({ ...current, viewNotes: (current.viewNotes || []).filter(item => item.id !== id) })); }
  function removeViewHighlight(id) { rememberUndo(); commitPaper(current => ({ ...current, viewHighlights: (current.viewHighlights || []).filter(item => item.id !== id) })); }
  function removePdfNote(id) { rememberUndo(); commitPaper(current => ({ ...current, pdfNotes: (current.pdfNotes || []).filter(item => item.id !== id) })); }
  function removePdfHighlight(id) { rememberUndo(); commitPaper(current => ({ ...current, pdfHighlights: (current.pdfHighlights || []).filter(item => item.id !== id) })); }
  async function saveGlossary(next) {
    const write = api.saveGlossary(next);
    glossarySave.current = write;
    setGlossarySaving(true);
    try {
      await write;
      setGlossary(next);
    } finally {
      glossarySave.current = null;
      setGlossarySaving(false);
    }
  }
  async function addTerm() {
    if (!selection || !termDraft.trim() || glossarySave.current) return;
    const key = selectionIdentity(selection);
    const sourceLanguage = selection.kind === 'translation' ? settings.targetLanguage : settings.sourceLanguage;
    const targetLanguage = selection.kind === 'translation' ? settings.sourceLanguage : settings.targetLanguage;
    setSelectionLookup({ status: '', error: '' });
    try {
      const next = upsertGlossaryTerm(glossary, { source: selection.quote ?? selection.text, target: termDraft, sourceLanguage, targetLanguage });
      try { await saveGlossary(next); }
      catch (cause) { throw new Error(`Could not save the term: ${cause.message}`); }
      if (selectionIdentity(selectionRef.current) === key) {
        setTermDraft('');
        setQuickTermOpen(false);
        setSelectionLookup({ status: 'Term saved for future translations.', error: '' });
      } else setStatus('Term saved for future translations.');
    } catch (cause) {
      if (selectionIdentity(selectionRef.current) === key) setSelectionLookup({ status: '', error: cause.message });
      else setError(cause.message);
    }
  }
  async function removeTerm(index) {
    if (glossarySave.current) return;
    setGlossaryError('');
    try { await saveGlossary(glossary.filter((_, at) => at !== index)); }
    catch (cause) { setGlossaryError(`Could not remove the term: ${cause.message}`); }
  }
  function bookmark(id) { const block = paper.blocks.find(item => item.id === id); rememberUndo(); updateBlock(id, { bookmark: !block.bookmark }); }
  function navigate(id, { revealSource = false, quote } = {}) {
    const block = paperRef.current?.blocks.find(block => block.id === id);
    if (!block || (quote && !block.text.includes(quote))) return;
    if (!quote && blockNavigation?.recordType === 'evidence' && blockNavigation.blockId === id) return;
    if (quote) {
      const text = anchorText(block, 'source');
      const offset = text.indexOf(quote);
      if (offset >= 0 && offset === text.lastIndexOf(quote)) {
        navigateBlockAnnotation(id, { text: quote, offset, scope: 'reader' }, 'source', 'evidence');
        return;
      }
    }
    const mode = revealSource && displayMode === 'translation' ? 'bilingual' : displayMode;
    recordReadingJump(location => location.tab === 'Reader' && !location.search && location.block === id && location.displayMode === mode);
    setBlockNavigation(null);
    searchOrigin.current = null; setSearch(''); setActiveBlock(id); setDisplayMode(mode); setTab('Reader');
    commitPaper(current => ({ ...current, position: { ...current.position, block: id, displayMode: mode } }));
    setTimeout(() => document.getElementById(`block-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  function navigateBlockAnnotation(blockId, item, kind, recordType) {
    const block = paperRef.current?.blocks.find(entry => entry.id === blockId);
    const scope = blockAnnotationScope(item);
    const targetTab = scope === 'paper' ? 'Paper' : 'Reader';
    if (item.needsReview || !block || !validBlockAnchor(block, item, kind)) {
      if (!item.needsReview && block) commitPaper(current => ({ ...current, blocks: current.blocks.map(entry => entry.id !== blockId ? entry : recordType === 'note'
        ? { ...entry, notes: (entry.notes || []).map(note => note.id === item.id ? { ...note, needsReview: true } : note) }
        : { ...entry, [kind === 'translation' ? 'translationHighlights' : 'highlights']: (entry[kind === 'translation' ? 'translationHighlights' : 'highlights'] || []).map(highlight => highlight === item ? { ...highlight, needsReview: true } : highlight) }) }));
      setError(`The saved ${scope === 'paper' ? 'Paper' : 'Reader'} text no longer matches this block. The annotation was kept for review.`);
      return;
    }
    const mode = scope === 'paper' ? 'bilingual' : (kind === 'translation' && displayMode === 'source' || kind === 'source' && displayMode === 'translation') ? 'bilingual' : displayMode;
    recordReadingJump(location => location.tab === targetTab && (scope === 'paper' || !location.search) && location.block === blockId && location.displayMode === mode
      && selectionRef.current?.scope === scope && selectionRef.current?.id === blockId && selectionRef.current?.kind === kind
      && sameTextAnchor(selectionRef.current, item));
    invalidateReadingScroll();
    if (tab !== targetTab || displayMode !== mode || search) setSelection(null);
    if (recordType !== 'evidence') setInspector(true);
    setSearch(''); searchOrigin.current = null; setActiveBlock(blockId); setDisplayMode(mode); setTab(targetTab);
    setBlockNavigation({ ...item, scope, blockId, kind, recordType, requestId: crypto.randomUUID() });
    commitPaper(current => ({ ...current, position: { ...current.position, tab: targetTab, block: blockId, displayMode: mode } }));
  }
  function markViewAnchorForReview(item) {
    if (!item.needsReview) commitPaper(current => ({ ...current,
        viewNotes: (current.viewNotes || []).map(note => note.id === item.id ? { ...note, needsReview: true } : note),
        viewHighlights: (current.viewHighlights || []).map(highlight => highlight.id === item.id ? { ...highlight, needsReview: true } : highlight)
    }));
    setError('The saved Markdown text no longer matches this view. The annotation was kept for review.');
  }
  function navigateView(item) {
    if (!validViewAnchor(paperRef.current, item)) {
      markViewAnchorForReview(item);
      return;
    }
    const targetTab = markdownViewTab(item.scope);
    const article = item.scope === 'paperArticle';
    if (article && item.sourceMode !== paperArticleSource(paperRef.current).mode) {
      if (!switchSourceMode(item.sourceMode)) return;
    } else {
      recordReadingJump(location => location.tab === targetTab && (!article || location.displayMode === item.displayMode)
        && selectionRef.current && sameViewAnchor(selectionRef.current, item));
      invalidateReadingScroll();
    }
    if (article) changeDisplayMode(item.displayMode);
    setInspector(true);
    setTab(targetTab);
    setViewNavigation({ ...item, requestId: crypto.randomUUID() });
  }
  function navigatePdf(item) {
    if (item.needsReview) { setError('This saved PDF annotation needs review before it can be opened.'); return; }
    const scope = pdfAnnotationScope(item);
    const targetTab = scope === 'paperPdf' ? 'Paper' : 'Original';
    recordReadingJump(location => location.tab === targetTab && selectionRef.current?.scope === scope
      && samePdfSelection(item, selectionRef.current));
    setInspector(true); setTab(targetTab); setPageNumber(item.page);
    if (scope === 'paperPdf') setDisplayMode('source');
    setPdfNavigation({ ...item, scope, id: crypto.randomUUID() });
    commitPaper(current => ({ ...current, position: { ...current.position, tab: targetTab, page: item.page, ...(scope === 'paperPdf' ? { displayMode: 'source' } : {}) } }));
  }
  function pdfNavigationReady(anchor) {
    const scope = pdfAnnotationScope(pdfNavigation);
    const next = { ...anchor, id: null, kind: 'source', scope, rect: null };
    const current = paperRef.current;
    if (anchor.quote) {
      const needsQuote = item => !item.quote && !item.needsReview && highlightMatchesSelection(item, next);
      if (current.pdfNotes?.some(needsQuote) || current.pdfHighlights?.some(needsQuote)) {
        const update = items => items?.map(item => needsQuote(item) ? { ...item, quote: anchor.quote } : item);
        commitPaper(paper => ({ ...paper, pdfNotes: update(paper.pdfNotes), pdfHighlights: update(paper.pdfHighlights) }));
      }
    }
    setSelection(next);
    setSelectionResults({});
    setNoteDraft(findSelectionNote(current, next)?.body || '');
    setPdfNavigation(null);
  }
  function pdfNavigationFailed() {
    const requested = pdfNavigation;
    if (requested) commitPaper(current => ({ ...current,
      pdfNotes: (current.pdfNotes || []).map(item => samePdfSelection(item, requested) ? { ...item, needsReview: true } : item),
      pdfHighlights: (current.pdfHighlights || []).map(item => samePdfSelection(item, requested) ? { ...item, needsReview: true } : item)
    }));
    setPdfNavigation(null);
    setError('The saved PDF text no longer matches its page ranges. The annotation was kept for review.');
  }
  function resetStructureNavigation() {
    resetReadingHistory();
    window.getSelection()?.removeAllRanges();
    setEdit(null); setSelection(null); setSelectionResults({}); setNoteDraft('');
    setBlockNavigation(null); setViewNavigation(null);
  }
  function modifyBlocks(start, count, replacements) {
    if (taskRef.current) { setError('Finish or stop the current task before editing the source.'); return; }
    if (paper.sourceMode === 'mineru') { setError('MinerU controls this document structure. Edit an exported Markdown copy instead.'); return; }
    resetStructureNavigation();
    rememberUndo();
    const range = { start, beforeEnd: start + count, afterEnd: start + replacements.length };
    commitPaper(current => {
      const blocks = current.blocks.slice(0, start).concat(replacements, current.blocks.slice(range.beforeEnd))
        .map((block, index) => ({ ...block, id: index + 1 }));
      return { ...current, blocks, position: { ...current.position, block: start + 1 },
        summary: remapSummaryEvidence(current.summary, current.blocks, blocks, range),
        connectedStale: Boolean(current.connectedTranslation) };
    }, { undoRange: range });
    setActiveBlock(start + 1);
  }
  function saveEdit() {
    const block = paper.blocks[edit.id - 1];
    const replacements = editedParagraphs(block, edit.text);
    if (!replacements.length) { setError('Enter at least one paragraph before saving.'); return; }
    if (replacements[0] === block) { setEdit(null); return; }
    modifyBlocks(edit.id - 1, 1, replacements);
  }
  function splitBlock(id) {
    const pieces = splitBlockNearMiddle(paper.blocks[id - 1]);
    if (pieces.length === 1) { setError('No safe sentence boundary found. Edit this block manually.'); return; }
    modifyBlocks(id - 1, 1, pieces);
  }
  function reflowParagraph(id) {
    const block = paper.blocks.find(item => item.id === id);
    const pieces = reflowBlock(block);
    if (pieces.length === 1) { setStatus(`Block ${id} is already short enough or has no safe sentence boundary.`); return; }
    modifyBlocks(id - 1, 1, pieces);
    setStatus(`Reflowed block ${id} into ${pieces.length} complete-sentence blocks.`);
  }
  function captureViewSelection(surface, scope) {
    const host = scope === 'paper' ? surface : surface.querySelector('[data-markdown-host]');
    const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
    if (!range) return;
    let kind = scope === 'summarySource' ? 'source' : 'translation';
    let id = null;
    let captured;
    let offsets = { offset: null };
    if (scope === 'paper') {
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
      const side = start?.closest('[data-paper-kind]');
      kind = side?.dataset.paperKind || 'source';
      const element = side?.closest('[data-paper-block-id]');
      const block = paperRef.current?.blocks.find(item => item.id === Number(element?.dataset.paperBlockId));
      const rich = Boolean(side?.querySelector('[data-markdown-host]'));
      const within = domRangeIn(side, range, rich);
      if (block && within) {
        captured = within;
        id = block.id;
        offsets = textSelectionOffsets(within, anchorText(block, kind), rich && blockMarkdown(block, kind));
      } else {
        captured = domRangeIn(host, range, true);
        if (captured) {
          scope = 'paperArticle';
          const source = paperArticleSource(paper);
          offsets = { ...selectionOffsets(captured, null, source), displayMode, sourceMode: source.mode };
        }
      }
    } else {
      captured = domRangeIn(host, range, true);
      const source = viewText(paperRef.current, scope);
      if (captured) offsets = textSelectionOffsets(captured, source, source);
    }
    if (!captured) return;
    const { text, rect } = captured;
    const nextSelection = { id, kind, text, ...offsets, scope, rect, context: captured.context.slice(Math.max(0, captured.offset - 300), captured.offset + text.length + 300) };
    return applyReadingSelection(nextSelection);
  }
  function applyReadingSelection(next) {
    const previous = selectionRef.current;
    if (selectionIdentity(previous) !== selectionIdentity(next)) {
      if (previous) void finishNoteEditing();
      setSelectionResults({});
      setNoteDraft(findSelectionNote(paperRef.current, next)?.body || '');
    }
    setSelection(next);
    return true;
  }
  function handleReadingKey(event) {
    if (modal || pendingImport || !Object.hasOwn(readingKeys, event.key) ||
        event.target.closest('a, button, input, textarea, select, [contenteditable]')) return;
    const host = event.target.closest('[data-reading-list], [data-view-scope], [data-pdf-scope]');
    if (!host) return;
    const scope = host.dataset.viewScope;
    const pdf = host.dataset.pdfScope;
    const reader = host.hasAttribute('data-reading-list');
    const selected = window.getSelection();
    let region = host;
    let initial = host;
    if (reader) {
      const anchor = selected?.anchorNode;
      const passage = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
      const selector = '.source-text, .translation-text.done';
      const active = passage?.closest(selector);
      region = initial = active && host.contains(active) ? active
        : host.querySelector(`#block-${activeBlock}`)?.querySelector(selector) || host.querySelector(selector);
    } else if (pdf) {
      initial = pdfLayerFor(host, pageNumber);
    } else if (scope !== 'paperArticle') {
      region = initial = host.querySelector('[data-markdown-host]');
    }
    if (!moveReadingSelection(event, region, initial, pdf)) return;
    if (!selected.isCollapsed) {
      if (reader && captureSelection()) return;
      if (pdf) {
        const captured = capturePdfRange(host, selected.getRangeAt(0));
        if (captured && selectPdf(captured, pdf)) return;
      } else if (!reader && captureViewSelection(host, scope === 'paperArticle' ? 'paper' : scope)) return;
    }
    if (selectionRef.current) {
      void finishNoteEditing();
      setSelection(null); setSelectionResults({}); setNoteDraft('');
    }
  }
  function mergeBlock(id) { if (id > 1) mergeNextBlock(id - 1); }
  function mergeNextBlock(id) { if (id < paper.blocks.length) modifyBlocks(id - 1, 2, [mergeBlocks(paper.blocks[id - 1], paper.blocks[id])]); }
  const outline = useMemo(() => paper?.blocks.filter(block => block.heading) || [], [paper]);
  const sections = useMemo(() => sectionRanges(paper?.blocks || []), [paper]);
  const referenceIDs = useMemo(() => referenceBlockIds(paper?.blocks || []), [paper?.blocks]);
  const extractionIssues = useMemo(() => qualityIssues(paper?.blocks || [], referenceIDs), [paper, referenceIDs]);
  const filteredLibrary = library.filter(item => `${item.name} ${(item.tags || []).join(' ')}`.toLowerCase().includes(librarySearch.toLowerCase()));
  const visibleBlocks = paper?.blocks.filter(block => !search || `${block.text} ${block.translation}`.toLowerCase().includes(search.toLowerCase())) || [];
  const paragraphExplanation = cachedExplanation(paper, activeBlock, explanationLanguage, settings);
  const translatedCount = paper?.blocks.filter(block => block.status === 'ok' && !block.resource && !referenceIDs.has(block.id)).length || 0;
  const failedCount = paper?.blocks.filter(block => block.status === 'failed' && !block.resource && !referenceIDs.has(block.id)).length || 0;
  const translatableCount = paper?.blocks.filter(block => !block.resource && !referenceIDs.has(block.id)).length || 0;
  const canSummarize = useMemo(() => summarySourceBlocks(paper?.blocks || []).length > 0, [paper?.blocks]);
  const activeSelectionHighlights = selectionHighlights(paper, selection);
  const activeHighlightColor = activeSelectionHighlights.length ? displayHighlightColor(activeSelectionHighlights[0].color) : '';
  const readingAppearance = { '--reader-font': `${settings?.fontSize || 17}px`, '--reader-line': settings?.lineHeight || 1.6, '--reader-width': `${settings?.readingWidth || 920}px` };
  const currentSection = sections.findLast(section => section.startId <= activeBlock);
  const currentSectionIds = translationRangeIds(paper?.blocks || [], currentSection?.ids || [], referenceIDs);
  const abstractConclusionIds = translationRangeIds(paper?.blocks || [], sections.filter(section => /abstract|conclusion|摘要|结论/i.test(section.title)).flatMap(section => section.ids), referenceIDs);
  const unfinishedTranslationIds = translationRangeIds(paper?.blocks || [], null, referenceIDs);
  const structuredFull = usesSharedMarkdown(paper);
  const pdfFacsimile = paper?.type === 'pdf' && paper.sourceMode !== 'mineru';
  const plainUnfinished = structuredFull ? [] : pendingConnectedBatches(paper);
  const fullTranslationNeedsWork = paper && (!paper.connectedTranslation || paper.connectedStale
    || plainUnfinished.length > 0 || (structuredFull && (!paper.connectedShared || unfinishedTranslationIds.length > 0)));
  const fullTranslationAction = !paper?.connectedTranslation ? 'Translate full paper'
    : structuredFull ? 'Update from Reader' : plainUnfinished.length ? 'Resume unfinished batches' : 'Regenerate';
  const menuReady = ready && modal !== 'onboarding';
  const menuBusy = Boolean(busy || onboardingBusy);
  const canPrimaryTask = tab === 'Summary' ? canSummarize && (!paper.summary || paper.summary.stale)
    : translatableCount > 0 && (tab === 'Full Translation' ? fullTranslationNeedsWork : translatedCount < translatableCount);
  const canUndo = undo.length > 0 && (!menuBusy || undo.at(-1)?.type !== 'structure');
  useEffect(() => {
    api.updateMenuState({ ready: menuReady, hasPaper: Boolean(paper), busy: menuBusy, hasSelection: Boolean(selection), canUndo,
      canGoBack: readingHistoryState.back > 0, canGoForward: readingHistoryState.forward > 0,
      canPrimaryTask: Boolean(canPrimaryTask), canSummarize, canFullTranslation: translatableCount > 0,
      canLookupSelection: Boolean(selection) && !menuBusy, canExport: Boolean(paper), checkingUpdates }).catch(cause => setError(cause.message));
  }, [menuReady, Boolean(paper), menuBusy, Boolean(selection), canUndo, readingHistoryState.back, readingHistoryState.forward, Boolean(canPrimaryTask), canSummarize, translatableCount > 0, checkingUpdates]);

  if (!ready || !settings) return <div className="loading">Opening PaperBridge…</div>;
  return <div data-display-mode={displayMode} style={readingAppearance} onDragOver={event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); }} onDrop={dropPdf} className={`app ${focus ? 'focus' : ''} ${!sidebar ? 'no-sidebar' : ''} ${!inspector ? 'no-inspector' : ''} ${pendingImport ? 'importing' : ''}`}>
    <aside className="sidebar" inert={Boolean(modal)}>
      <div className="brand"><img src="./brand.png" alt="" /><div><strong>PaperBridge</strong><small>Papers across languages</small><em>● Private by design</em></div></div>
      <div className="sidebar-scroll">
        <div className="side-group"><div className="side-label">SOURCE</div><button className="side-primary" onClick={openFile}><FilePlus2 size={16} /> Open PDF</button><button className="side-action" onClick={() => setModal('paste')}><FileText size={15} /> Paste Text</button><button className="side-action" onClick={loadPractice}><BookOpen size={15} /> Try a Practice Paper</button></div>
        <div className="side-group"><div className="side-label">LIBRARY <button title="Open library" onClick={() => setModal('library')}><Library size={15} /></button></div><input className="side-search" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Search papers or tags" />{filteredLibrary.slice(0, 12).map(item => <button key={item.id} className={`library-row ${paper?.id === item.id ? 'selected' : ''}`} onClick={() => loadPaper(item.id).catch(err => setError(err.message))}><span>{short(item.name, 29)}</span><small>{item.blockCount} blocks</small></button>)}</div>
        {pendingImport ? <div className="side-group"><div className="side-label">IMPORTING</div><strong className="side-title">{pendingImport.name}</strong><p className="side-hint">{pendingImport.stage}</p></div> : paper && <><div className="side-group"><div className="side-label">DOCUMENT</div><strong className="side-title">{paper.name}</strong><div className="side-stat"><span>Blocks</span><b>{paper.blocks.length}</b></div><div className="side-stat"><span>Translated</span><b>{translatedCount}</b></div>{failedCount > 0 && <div className="side-stat failed-stat"><span>Failed</span><b>{failedCount}</b></div>}<div className="side-stat"><span>Parser</span><b>{paper.extraction}</b></div></div><div className="side-group"><div className="side-label">OUTLINE</div>{outline.slice(0, 60).map(block => <button className="outline-row" key={block.id} onClick={() => navigate(block.id)}><span>{short(block.text, 48)}</span><small>{block.page || block.id}</small></button>)}{!outline.length && <p className="side-hint">No headings detected.</p>}</div><div className="side-group"><div className="side-label">BOOKMARKS</div>{paper.blocks.filter(block => block.bookmark).map(block => <button className="outline-row" key={block.id} onClick={() => navigate(block.id)}>{short(block.text, 52)}</button>)}</div></>}
      </div>
      <div className="sidebar-footer"><button onClick={() => setModal('setup')}><Download size={16} /> Local AI setup</button><button onClick={() => setModal('settings')}><Settings2 size={16} /> Settings</button><button onClick={() => setModal('glossary')}><Languages size={16} /> Saved Terminology</button></div>
    </aside>
    <main className="workspace" inert={Boolean(modal)}>
      <header className="header"><div className="title-row"><button className="icon-button panel-toggle" title="Toggle sidebar" onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button><button className="icon-button" aria-label="Back to previous reading location" title="Back · Ctrl+[" disabled={!readingHistoryState.back || pendingImport} onClick={goBackInReading}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Forward in reading history" title="Forward · Ctrl+]" disabled={!readingHistoryState.forward || pendingImport} onClick={goForwardInReading}><ChevronRight size={18} /></button><div className="title-wrap"><h1>{pendingImport?.name || paper?.name || 'PaperBridge'}</h1><p>{pendingImport ? `${pendingImport.stage} · ${importElapsed}s elapsed` : paper ? `${settings.sourceLanguage} → ${settings.targetLanguage} · ${paper.extraction} · ${paper.blocks.length} blocks` : 'A local space for academic reading'}</p></div><div className={`service ${settings.aiProvider === 'openai' ? !openAIState.consent ? 'offline' : '' : ollamaError ? 'offline' : ''}`} title={settings.aiProvider === 'openai' ? openAIState.consent ? 'Text analysis uses your OpenAI API account.' : 'Online analysis is paused until enabled in Settings.' : ollamaError || 'Local Ollama is available'}>● {settings.aiProvider === 'openai' ? openAIState.consent ? 'OpenAI Online' : 'OpenAI Paused' : ollamaError ? 'Ollama unavailable' : 'Ollama Ready'}</div><button className="icon-button" title="Toggle inspector" disabled={Boolean(pendingImport)} onClick={() => { if (inspector) void finishNoteEditing(); setInspector(!inspector); }}>{inspector ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div>
      {paper && !pendingImport && <div className="header-tools"><nav className="tabs">{[{ name: 'Paper', label: 'Paper' }, { name: 'Reader', label: 'Reader' }, { name: 'Original', label: 'Original' }, { name: 'Summary', label: 'Overview' }, { name: 'Full Translation', label: 'Full Translation' }].map(item => <button key={item.name} className={tab === item.name ? 'active' : ''} onClick={() => setTab(item.name)}>{item.label}</button>)}</nav><div className="toolbar-actions">{busy ? <button className="button danger" onClick={cancelTask}><Square size={14} /> Stop</button> : <button className="button coral" disabled={!translatableCount || translatedCount === translatableCount} onClick={() => translateBlocks(paper.blocks.map(block => block.id))}><Languages size={16} /> {translatedCount ? 'Resume Translation' : 'Translate Paper'}</button>}<button className="button ghost" onClick={() => setModal('more')}>More ···</button></div></div>}
      </header>
      {(error || updateInfo?.status === 'available' || busy || paper && workspaceSave.status !== 'idle') && <div className="workspace-status-rail" aria-live="polite">
        {error && <Notice tone="error" onClose={() => setError('')}>{error}</Notice>}
        {updateInfo?.status === 'available' && <div className="update-banner" role="status"><div><strong>PaperBridge for Windows {updateInfo.latestVersion} is available</strong><p>Review the official release before downloading. Your papers remain on this computer.</p></div><button className="button blue" onClick={openUpdateRelease}>View release</button><button className="button ghost" onClick={() => setUpdateInfo(null)}>Later</button></div>}
        {busy && <TaskProgress busy={busy} progress={progress} failedCount={failedCount} />}
        {busy && !paper && <button className="button danger" onClick={cancelTask}><Square size={14} /> Stop</button>}
        {paper && workspaceSave.status !== 'idle' && <div className={`save-status ${workspaceSave.status}`} role={workspaceSave.status === 'error' ? 'alert' : 'status'}>
          <span>{workspaceSave.status === 'saving' ? 'Saving changes…' : workspaceSave.status === 'saved' ? 'Saved on this PC' : `Could not save changes${workspaceSave.error?.message ? `: ${workspaceSave.error.message}` : '.'}`}</span>
          {workspaceSave.status === 'error' && <button className="button outline" onClick={retryPaperSave}>Retry save</button>}
        </div>}
      </div>}
      <div className="main-scroll" ref={mainScrollRef} onScroll={saveMainScroll} onKeyDown={handleReadingKey}>
        {pendingImport ? <ImportProgress item={pendingImport} elapsed={importElapsed} onCancel={cancelTask} /> : <>
        {paper && status && <Notice>{status}</Notice>}
        {!paper && <div className="welcome"><img src="./brand.png" alt="" /><h1>Read across languages, locally.</h1><p>Keep the original paper nearby while translating, annotating, and exploring with local models.</p><div className="row"><button className="button blue" onClick={openFile}><FolderOpen size={17} /> Open PDF</button><button className="button outline" onClick={() => setModal('paste')}>Paste Text</button><button className="button outline" onClick={loadPractice}>Try a Practice Paper</button><button className="button outline" onClick={() => setModal('setup')}>Set up local AI</button></div><p className="welcome-note">Reading and notes work without AI. One-click setup detects and installs missing local tools.</p></div>}
        {paper && tab === 'Paper' && <div className={pdfFacsimile && displayMode !== 'source' ? 'content-column pdf-comparison-column' : 'content-column'}>
          <div className="section-heading"><div><h2>Full document preview</h2><p>{paper.type === 'pdf' && displayMode === 'source' ? 'Exact native PDF rendering with selectable text and original page layout' : paper.sourceMode === 'mineru' && paper.mineruMarkdown ? 'MinerU Markdown with structure and formulas' : paper.type === 'pdf' ? 'Reflowed selectable PDF text · exact pages remain available in Original mode' : 'Selectable source text in a reflowable reading view'}</p></div><div className="row"><select aria-label="Paper display mode" value={displayMode} onChange={event => changeDisplayMode(event.target.value)}><option value="bilingual">Bilingual</option><option value="source">Original</option><option value="translation">Translation</option></select><button className="button outline" onClick={() => navigateToTab('Reader')}>Open Reader</button>{paper.type === 'pdf' && <button className="button outline" onClick={() => navigateToTab('Original')}>Original PDF</button>}</div></div>
          {paper.mineruBlocks && <div className="source-mode row"><span>Reader source: {paper.sourceMode === 'mineru' ? 'MinerU Markdown' : 'PDF text'}</span><button className="button outline" onClick={() => switchSourceMode(paper.sourceMode === 'mineru' ? 'pdf' : 'mineru')}>Switch to {paper.sourceMode === 'mineru' ? 'PDF text' : 'MinerU Markdown'}</button></div>}
          {paper.type === 'pdf' && displayMode === 'source' ? <PdfView
            key={paper.id}
            paper={paper}
            scope="paperPdf"
            pageNumber={pageNumber}
            position={paper.position?.scrollByTab?.[pdfScrollKey('paperPdf', pageNumber)] || 0}
            restoreToken={readingRestoration.current}
            annotations={pdfAnnotationsFor(paper, 'paperPdf')}
            selected={selection?.scope === 'paperPdf' ? selection : null}
            navigation={pdfNavigation?.scope === 'paperPdf' ? pdfNavigation : null}
            onPage={(...args) => changePdfPage('paperPdf', ...args)}
            onScrollSelection={hideQuickSelectionOnScroll}
            onSelect={anchor => selectPdf(anchor, 'paperPdf')}
            onNavigate={pdfNavigationReady}
            onNavigationFailure={pdfNavigationFailed}
            onOcr={runMineru}
            onSetup={() => setModal('setup')}
            onReader={openPdfReader}
          /> : <>
            {paper.type === 'pdf' && !paper.blocks.length && <ScanNotice onParse={runMineru} onSetup={() => setModal('setup')} />}
            <div className={pdfFacsimile ? 'pdf-comparison' : undefined}>
              {pdfFacsimile && <PdfFacsimile paper={paper} pageNumber={pageNumber} onPage={changeFacsimilePage} onOriginal={() => navigateToTab('Original')} />}
              <PaperPreview paper={paper} displayMode={displayMode} referenceIDs={referenceIDs} onSelect={captureViewSelection} />
            </div>
          </>}
        </div>}
        {paper && tab === 'Reader' && <div className="reader-layout"><div className="reader-top"><div><h2>{displayMode === 'bilingual' ? 'Bilingual Reader' : displayMode === 'source' ? 'Original Reader' : 'Translation Reader'}</h2><p>{translatedCount} of {translatableCount} blocks translated</p></div><div className="row"><select className="reader-mode-select" aria-label="Reading mode" value={displayMode} onChange={event => changeDisplayMode(event.target.value)}><option value="bilingual">Bilingual</option><option value="source">Original</option><option value="translation">Translation</option></select><input ref={searchRef} className="search" placeholder="Search paper  Ctrl+F" value={search} onChange={event => changeSearch(event.target.value)} /><button className="icon-button" title="Focus reading" onClick={toggleFocus}><Focus size={18} /></button></div></div><div className="reader-list" data-reading-list tabIndex={0} role="region" aria-label="Reader text" style={{ '--reader-font': `${settings.fontSize}px`, '--reader-line': settings.lineHeight, '--reader-width': `${settings.readingWidth}px` }} onMouseUp={captureSelection}>{visibleBlocks.map(block => <article id={`block-${block.id}`} key={block.id} className={`block ${block.heading ? 'heading-block' : ''} ${activeBlock === block.id ? 'current' : ''}`} data-heading-status={block.heading ? block.status : undefined} onClick={() => { setActiveBlock(block.id); if (paper.position?.block !== block.id) commitPaper(current => ({ ...current, position: { ...current.position, block: block.id } })); }}><div className="block-header"><span>{block.page ? `PAGE ${block.page} · ` : ''}BLOCK {block.id}</span><div className="row"><button className={`mini-action ${block.bookmark ? 'bookmarked' : ''}`} title={block.heading ? 'Bookmark heading' : 'Bookmark'} onClick={event => { event.stopPropagation(); bookmark(block.id); }}><Bookmark size={15} fill={block.bookmark ? 'currentColor' : 'none'} /></button><button className="mini-action" title={block.heading ? 'Edit or split heading' : 'Edit source'} disabled={paper.sourceMode === 'mineru'} onClick={event => { event.stopPropagation(); setEdit({ id: block.id, text: block.text }); }}><Pencil size={15} /></button>{!referenceIDs.has(block.id) && (!block.heading || block.status !== 'ok' && displayMode !== 'source') && <button className="mini-action" title={block.heading ? block.status === 'failed' ? 'Retry heading' : 'Translate heading' : 'Translate or retry block'} onClick={event => { event.stopPropagation(); translateBlocks([block.id]); }}><Languages size={15} /></button>}<button className="mini-action" title={block.heading ? 'Explain heading' : 'Explain full paragraph'} disabled={block.resource} onClick={event => { event.stopPropagation(); setActiveBlock(block.id); explainBlock(block.id); }}><Sparkles size={15} /></button></div></div>{edit?.id === block.id ? <div className="edit-area" onClick={event => event.stopPropagation()}><textarea aria-label="Paragraph source" value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })} /><div className="row"><button className="button blue" onClick={saveEdit}>Save edit</button><button className="button ghost" onClick={() => setEdit(null)}>Cancel</button><button className="button ghost" onClick={() => splitBlock(block.id)}><Scissors size={15} /> Split</button><button className="button ghost" onClick={() => reflowParagraph(block.id)}>Reflow at full sentences</button><button className="button ghost" disabled={block.id === 1} onClick={() => mergeBlock(block.id)}><Merge size={15} /> Merge previous</button><button className="button ghost" disabled={block.id >= paper.blocks.length} onClick={() => mergeNextBlock(block.id)}><Merge size={15} /> Merge next</button></div></div> : <><BlockPassage block={block} kind="source" scope="reader" className="source-text" data-block-id={block.id} data-kind="source" />{!block.resource && !referenceIDs.has(block.id) && (block.status === 'ok' ? <BlockPassage block={block} kind="translation" scope="reader" className="translation-text done" data-block-id={block.id} data-kind="translation" /> : <div className="translation-text" data-block-id={block.id} data-kind="translation">{block.status === 'failed' ? <span className="failure"><AlertCircle size={15} /> {block.error || 'Translation failed'} <button onClick={() => translateBlocks([block.id])}>Retry</button></span> : <span className="pending">Translation pending · select the translate button to begin</span>}</div>)}</>}{blockAnnotationsFor(block.notes, 'reader').length > 0 && <div className="block-notes">{blockAnnotationsFor(block.notes, 'reader').map(note => <p key={note.id}><MessageSquareText size={14} /> <b>{short(note.text, 70)}</b> {note.body}</p>)}</div>}</article>)}{!visibleBlocks.length && (paper.type === 'pdf' && !paper.blocks.length ? <ScanNotice onParse={runMineru} onSetup={() => setModal('setup')} /> : <Empty title="No matching blocks" body="Try another search term." />)}</div>{undo.length > 0 && <button className="undo-button" onClick={undoLastChange}><Undo2 size={16} /> Undo last change</button>}</div>}
        {paper && tab === 'Original' && <PdfView
          key={paper.id}
          paper={paper}
          scope="pdf"
          pageNumber={pageNumber}
          position={paper.position?.scrollByTab?.[pdfScrollKey('pdf', pageNumber)] || 0}
          restoreToken={readingRestoration.current}
          annotations={pdfAnnotationsFor(paper, 'pdf')}
          selected={selection?.scope === 'pdf' ? selection : null}
          navigation={pdfNavigation?.scope !== 'paperPdf' ? pdfNavigation : null}
          onPage={(...args) => changePdfPage('pdf', ...args)}
          onScrollSelection={hideQuickSelectionOnScroll}
          onSelect={anchor => selectPdf(anchor, 'pdf')}
          onNavigate={pdfNavigationReady}
          onNavigationFailure={pdfNavigationFailed}
          onOcr={runMineru}
          onSetup={() => setModal('setup')}
          onReader={openPdfReader}
        />}
        {paper && tab === 'Summary' && <OverviewView paper={paper} busy={busy} canSummarize={canSummarize} summarize={summarize} navigate={navigate} onSelect={captureViewSelection} expandedEvidence={expandedEvidence} issues={extractionIssues} onOriginal={() => { changeDisplayMode('source'); navigateToTab('Paper'); }} onReader={() => navigateToTab('Reader')} translatedCount={paper.blocks.filter(block => block.status === 'ok').length} paragraphCount={paper.blocks.length} />}
        {paper && tab === 'Full Translation' && <div className={pdfFacsimile ? 'content-column pdf-comparison-column' : 'content-column'}>
          <div className="section-heading">
            <div><h2>Connected full translation</h2><p>{structuredFull
              ? 'Shares Reader translations and preserves Markdown structure'
              : 'A separate document-wide pass for consistent terminology'}</p></div>
            <button className="button coral" disabled={!!busy || !paper.blocks.some(block => !block.heading && !block.resource) || (structuredFull && !fullTranslationNeedsWork)}
              onClick={() => fullTranslation(fullTranslationAction === 'Regenerate')}><Languages size={16} /> {fullTranslationAction}</button>
          </div>
          {paper.connectedStale && <Notice tone="error">The source changed after this translation. Update it to match the current source.</Notice>}
          {structuredFull && paper.connectedShared && !paper.connectedStale && unfinishedTranslationIds.length > 0 &&
            <Notice>{unfinishedTranslationIds.length} unfinished block(s) shown in the original language.</Notice>}
          {plainUnfinished.length > 0 && <Notice>{plainUnfinished.length} unfinished batch(es) shown in the original language. Completed batches are saved.</Notice>}
          <div className={pdfFacsimile ? 'pdf-comparison' : undefined}>
            {pdfFacsimile && <PdfFacsimile paper={paper} pageNumber={pageNumber} onPage={changeFacsimilePage} onOriginal={() => navigateToTab('Original')} />}
            {paper.connectedTranslation ? <article className="document-preview" data-view-scope="fullTranslation" tabIndex={0} aria-label="Full translation text"
              onMouseUp={event => captureViewSelection(event.currentTarget, 'fullTranslation')}>
              <Markdown annotations={viewAnnotations(paper, 'fullTranslation')}>{paper.connectedTranslation}</Markdown>
            </article> : <Empty title={paper.blocks.length ? 'No full translation yet' : 'No readable text yet'} body={!paper.blocks.length
              ? 'Use MinerU OCR from Paper or Original before translating this PDF.'
              : structuredFull ? 'The full draft reuses completed Reader blocks and translates the remaining text in document order.'
              : 'This optional pass translates longer passages with context. The bilingual reader remains available separately.'} />}
          </div>
        </div>}
        </>}
      </div>
    </main>
    <aside className={`inspector ${compactInspector ? 'inspector-drawer' : 'inspector-sidebar'}`} inert={Boolean(modal)}><div className="inspector-title"><div><h2>Research Inspector</h2><small>Selection, explanation, highlights, and notes</small></div><div className="row"><button className="icon-button" title="Undo last highlight or note change" disabled={!canUndo} onClick={undoLastChange}><Undo2 size={16} /></button><button className="icon-button" aria-label={compactInspector ? 'Close inspector drawer' : 'Hide inspector'} onClick={() => { void finishNoteEditing(); setInspector(false); }}>{compactInspector ? <X size={16} /> : <PanelRightClose size={16} />}</button></div></div><div className="inspector-body"><div className="inspector-primary">{selection ? <div className="inspector-scroll"><div className="inspector-section"><small className="selection-meta"><span>{isPdfScope(selection.scope) ? `${selection.scope === 'paperPdf' ? 'PAPER · EXACT PDF' : 'ORIGINAL PDF'} · ${pdfPageLabel(selection).toUpperCase()}` : selection.id ? `SELECTED TEXT · BLOCK ${selection.id}` : `SELECTED TEXT · ${selection.scope === 'paperArticle' ? 'PAPER' : selection.scope}`}</span><span>{selection.kind === 'translation' ? 'TRANSLATION' : 'ORIGINAL'}</span></small><blockquote className={selection.scope === 'paperArticle' ? 'paper-article-quote' : undefined}>{short(selection.quote ?? selection.text, 350)}</blockquote><div className="action-grid"><button disabled={!!busy} onClick={() => runSelection('translate')}><Languages size={16} /> Translate</button><button disabled={!!busy} onClick={() => runSelection('explain')}><Sparkles size={16} /> Explain</button></div>{busy && taskRef.current?.kind === 'selection' && <div className="selection-lookup-busy" role="status"><span>{busy.label}</span><button onClick={cancelTask}>Cancel</button></div>}{!busy && selectionLookup.error && <p className="selection-lookup-message error" role="alert">{selectionLookup.error}</p>}{!busy && !selectionLookup.error && selectionLookup.status && <p className="selection-lookup-message">{selectionLookup.status}</p>}</div><SelectionResults results={selectionResults} /><div className="inspector-section"><small>HIGHLIGHT</small><HighlightControls activeColor={activeHighlightColor} onAdd={addHighlight} onRemove={removeSelectionHighlight} /></div><div className="inspector-section"><small>NOTE · AUTO-SAVES</small><textarea key={noteSelectionIdentity(paper.id, selection)} aria-label="Note for selected passage" placeholder="What should you remember?" value={noteDraft} onChange={event => updateNote(event.target.value, noteSelectionIdentity(paper.id, selection))} onBlur={() => void finishNoteEditing()} /><button className="button blue" onClick={saveNote}>Save note</button></div><div className="inspector-section"><small>SAVED TERMINOLOGY</small><input placeholder="Approved translation" value={termDraft} disabled={glossarySaving} onChange={event => setTermDraft(event.target.value)} /><button className="button outline" disabled={glossarySaving || !termDraft.trim()} onClick={addTerm}>Save term</button></div></div> : <div className="inspector-scroll"><p className="inspector-help">Select text in Paper, Reader, Original PDF, Overview summaries, or Full Translation to translate, explain, highlight, annotate, or save a term.</p>{paper && <><div className="inspector-section"><small>THIS PAPER</small><p>{paper.blocks.filter(block => block.bookmark).length} bookmarks · {paper.blocks.reduce((count, block) => count + (block.notes?.length || 0), 0) + (paper.pdfNotes?.length || 0) + (paper.viewNotes?.length || 0)} notes</p></div><div className="inspector-section"><small>QUICK ACTIONS</small><button className="inspector-link" onClick={() => setModal('range')}>Choose translation range</button><button className="inspector-link" onClick={() => setModal('export')}>Export Markdown</button><button className="inspector-link" onClick={() => setModal('settings')}>Local AI settings</button></div></>}</div>}</div><div className="inspector-supporting">{paper && (!selection || selection.scope === 'reader') && <ParagraphExplanation paper={paper} activeBlock={activeBlock} language={explanationLanguage} setLanguage={changeExplanationLanguage} result={paragraphExplanation} onExplain={explainBlock} busy={busy} />}{paper && <SavedAnnotations paper={paper} navigateBlockAnnotation={navigateBlockAnnotation} navigateView={navigateView} navigatePdf={navigatePdf} removeNote={removeNote} removeHighlight={removeHighlight} removeViewNote={removeViewNote} removeViewHighlight={removeViewHighlight} removePdfNote={removePdfNote} removePdfHighlight={removePdfHighlight} />}</div></div></aside>
    {selection?.rect && !modal && !inspector && !focus && <QuickSelection selection={selection} results={selectionResults} busy={busy} lookup={selectionLookup} activeColor={activeHighlightColor} quickTermOpen={quickTermOpen} termDraft={termDraft} termSaving={glossarySaving} setTermDraft={setTermDraft} onTranslate={() => runSelection('translate')} onExplain={() => runSelection('explain')} onHighlight={addHighlight} onRemoveHighlight={removeSelectionHighlight} onOpenTerm={() => { setTermDraft(selectionResults.translate || ''); setQuickTermOpen(true); }} onSaveTerm={addTerm} onCancelTerm={() => { setQuickTermOpen(false); setTermDraft(''); }} onMore={() => { setInspector(true); setTimeout(() => document.querySelector('.inspector-section textarea')?.focus(), 0); }} onCancelTask={cancelTask} onClose={() => { void finishNoteEditing(); setSelection(null); setSelectionResults({}); }} />}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) dismissModal(); }}><div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-busy={modal === 'onboarding' && onboardingFinishing} tabIndex={-1} className={`modal ${modal === 'onboarding' ? 'onboarding-modal' : modal === 'settings' ? 'settings-modal' : ''}`}><div className="modal-head"><h2 id="modal-title">{({ paste: 'Paste text', settings: 'Settings', setup: 'Local AI setup', onboarding: 'Getting Started', glossary: 'Saved Terminology', library: 'Paper Library', libraryLabel: 'Edit Library Label', more: 'More tools', range: 'Translation range', export: 'Export Markdown', clearData: 'Remove Saved Data' })[modal]}</h2><button className="icon-button" aria-label="Close dialog" disabled={modal === 'onboarding' && (onboardingBusy || onboardingFinishing)} onClick={dismissModal}><X size={19} /></button></div>{modal === 'onboarding' && onboardingSaveError && <p className="onboarding-error" role="alert">{onboardingSaveError}</p>}<div className="modal-body" inert={modal === 'onboarding' && onboardingFinishing}>
      {modal === 'paste' && <><p>Paste a passage or complete paper. It stays on this computer.</p><textarea className="paste-area" value={paste} onChange={event => setPaste(event.target.value)} placeholder="Paste academic text here…" /><button className="button blue" onClick={() => importText(paste)}>Open text</button></>}
      {modal === 'onboarding' && <Onboarding settings={settings} onSettings={updateSettings} onFinish={finishOnboarding} onOpenSetup={() => finishOnboarding('setup')} progress={setupProgress} pullProgress={pullProgress} models={models} onModelsChanged={() => refreshModels(settingsRef.current)} onBusyChange={handleOnboardingBusy} />}
      {modal === 'setup' && <SetupPanel settings={settings} progress={setupProgress} onSettings={updateSettings} onInstalled={() => refreshModels(settings)} />}
      {modal === 'settings' && <SettingsPanel settings={settings} onSettings={updateSettings} languages={languages} busy={Boolean(busy)}
        onOnboarding={openOnboarding} onOpenSetup={() => setModal('setup')} onClearData={() => setModal('clearData')}
        modelTools={{ models, ollamaError, pulling, cancelling: cancellingPull, progress: pullProgress, message: modelDownloadMessage, error: modelDownloadError,
          name: pullModel, onName: setPullModel, onRefresh: () => refreshModels(settingsRef.current), onDownload: downloadModel, onCancel: cancelModelDownload,
          onUse: useRecommendedModel, onRecommendation: model => { setPullModel(model.id); downloadModel(model.id, model); } }}
        openAITools={{ ...openAIState, onKeyStatus: refreshOpenAIKeyStatus, onSaveKey: saveOpenAIKey, onRemoveKey: removeOpenAIKey, onConsent: setOpenAIConsent, onRefresh: refreshOpenAIModels }}
        hardwareTools={{ hardware, mineruRuntime, runningModels, checking: checkingHardware, onCheck: checkHardware, error: hardwareError }}
        updates={{ version: appVersion, checking: checkingUpdates, status: updateStatus, onCheck: () => checkForUpdates(false) }} />}
      {modal === 'glossary' && <><p>Approved terms guide future translations in the same language direction.</p><input placeholder="Search saved terms" value={glossarySearch} onChange={event => setGlossarySearch(event.target.value)} />{[...glossary.entries()].filter(([, term]) => glossaryTermMatchesQuery(term, glossarySearch)).map(([index, term]) => <div className="term-row" key={`${term.source}-${index}`}><span><b>{term.source}</b> → {term.target}<small>{term.sourceLanguage} → {term.targetLanguage}</small></span><button className="icon-button" aria-label={`Remove ${term.source}`} disabled={glossarySaving} onClick={() => removeTerm(index)}><Trash2 size={16} /></button></div>)}{glossaryError && <p role="alert" className="selection-lookup-message error">{glossaryError}</p>}{!glossary.length && <p>No saved terms yet. Select a phrase in Reader to add one.</p>}</>}
      {modal === 'library' && <LibraryView items={filteredLibrary} query={librarySearch} setQuery={setLibrarySearch} loadPaper={loadPaper} setModal={setModal} busy={Boolean(busy)} setLibraryEdit={setLibraryEdit} />}
      {modal === 'libraryLabel' && libraryEdit && <><p>Only the library label changes; the original PDF stays unchanged.</p><label>Title<input value={libraryEdit.name} onChange={event => setLibraryEdit({ ...libraryEdit, name: event.target.value })} /></label><label>Tags, separated by commas<input value={libraryEdit.tags} onChange={event => setLibraryEdit({ ...libraryEdit, tags: event.target.value })} /></label><div className="row"><button className="button blue" disabled={!libraryEdit.name.trim()} onClick={saveLibraryLabel}>Save label</button><button className="button outline" onClick={() => setModal('library')}>Cancel</button></div></>}
      {modal === 'more' && <div className="menu-list"><button onClick={() => setModal('range')}><Languages size={17} /> Translation Range</button><button onClick={() => { setModal(''); runMineru(); }} disabled={paper?.type !== 'pdf'}><FileText size={17} /> Parse with MinerU</button><button onClick={reextractAsNew} disabled={paper?.type !== 'pdf' || !!busy}><FilePlus2 size={17} /> Re-extract PDF as New Copy</button><button onClick={() => setModal('export')}><Download size={17} /> Export Markdown</button><button onClick={() => { setModal(''); toggleFocus(); }}><Focus size={17} /> {focus ? 'Exit Focus Reading' : 'Focus Reading'}</button><button onClick={() => setModal('settings')}><Settings2 size={17} /> Settings</button></div>}
      {modal === 'range' && <div className="menu-list">
        <button disabled={!!busy || !abstractConclusionIds.length} onClick={() => { setModal(''); translateBlocks(abstractConclusionIds); }}>Abstract & Conclusion <small>{abstractConclusionIds.length} blocks</small></button>
        <button disabled={!!busy || !currentSectionIds.length} onClick={() => { setModal(''); translateBlocks(currentSectionIds); }}>Current section: {currentSection?.title || 'Opening material'} <small>{currentSectionIds.length} blocks</small></button>
        {translationQueueRef.current && <button onClick={() => { prioritizeSection(currentSectionIds); setModal(''); }}>Prioritize current section in queue</button>}
        {sections.map(section => { const ids = translationRangeIds(paper.blocks, section.ids, referenceIDs); return <button key={section.startId} disabled={!!busy || !ids.length} onClick={() => { setModal(''); translateBlocks(ids); }}>Choose section: {section.title}<small>{ids.length} unfinished blocks</small></button>; })}
        <button disabled={!!busy || !unfinishedTranslationIds.length} onClick={() => { setModal(''); translateBlocks(unfinishedTranslationIds); }}>All unfinished blocks <small>{unfinishedTranslationIds.length} blocks</small></button>
      </div>}

      {modal === 'clearData' && <><p>This removes saved papers, translations, bookmarks, notes, terminology, and settings. Original PDF copies and the separately encrypted OpenAI API key remain; remove the key under Models. Text already sent online cannot be recalled.</p><div className="row"><button className="button danger" onClick={clearSavedData}>Remove saved data</button><button className="button outline" onClick={() => setModal('settings')}>Cancel</button></div></>}
      {modal === 'export' && <div className="menu-list"><button onClick={exportBundle}><Download size={17} /> Export portable Markdown bundle</button>{[['original', 'Original Markdown'], ['translated', 'Translated Markdown'], ['bilingual', 'Bilingual Markdown'], ['analysis', 'Summary, sources and notes'], ...(paper.connectedTranslation ? [['full', 'Full Translation Markdown']] : [])].map(([kind, label]) => <button key={kind} onClick={() => exportMarkdown(kind)}><Download size={17} /> {label}</button>)}</div>}
    </div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
