import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { BookOpen, FilePlus2, FolderOpen, Search, Settings2, Languages, Bookmark, Highlighter, MessageSquareText, Download, X, PanelRightClose, PanelRightOpen, ArrowRightLeft, Play, Square, RefreshCw, FileText, Library, ChevronLeft, ChevronRight, List, Sparkles, Pencil, Trash2, Undo2, Merge, Scissors, Focus, PanelLeftClose, PanelLeftOpen, Check, AlertCircle } from 'lucide-react';
import { openPdf, extractPdf } from './pdf.mjs';
import { blocksFromText, readingMap, chunkText, isHeading } from './text.mjs';
import { translationSystem, translationPrompt, explainPrompt, summaryPrompt, mergeSummaryPrompt, summaryQuotePrompt, protectMarkdown, restoreMarkdown, markdownTranslationPrompt } from './prompts.mjs';
import { referenceBlockIds, sectionRanges, translationRangeIds, qualityIssues, parseSummaryClaims, summarySourceCandidates, claimsMarkdown, revalidateSummaryClaims, splitBlockAt, reflowBlock, mergeBlocks, editedBlock } from './paper.mjs';
import { anchorText, parsedMarkdownBlocks } from './academicMarkdown.mjs';
import { TASK_SETTING_KEYS, snapshotPaperSettings, restorePaperSettings } from './paperSettings.mjs';
import { switchOutputSettings, migrateExplanations, cachedExplanation, explanationKey } from './outputCache.mjs';
import { createUndoEntry, applyUndoEntry } from './paperUndo.mjs';
import { annotationsMarkdown } from './annotationsMarkdown.mjs';
import { applySelectionNote, findSelectionNote, noteSelectionIdentity, sameNoteSelection, validNoteSelection } from './noteAnnotations.mjs';
import { createPaperSaveQueue } from './paperSaveQueue.mjs';
import { createReadingHistory } from './readingHistory.mjs';
import SetupPanel from './SetupPanel.jsx';
import Onboarding from './Onboarding.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import { modelSettingsPatch } from './modelCatalog.mjs';
import './onboarding.css';
import 'katex/dist/katex.min.css';
import './style.css';
import './hardware.css';
import './parity.css';
import './save-status.css';

const api = window.paperBridge;
const ONBOARDING_VERSION = 1;
const selectionIdentity = value => value ? JSON.stringify([value.scope, value.id, value.page, value.kind, value.offset, value.text]) : '';
const languages = ['English', 'Simplified Chinese', 'Traditional Chinese', 'Japanese', 'Korean', 'French', 'German', 'Spanish', 'Italian', 'Portuguese', 'Russian'];
const sample = ['Abstract', 'This is a fictional practice document, not a published study. Use it to explore source-linked reading, translation, highlights, and notes without importing a personal paper.', '1 Introduction', 'Reading a paper across languages involves more than translating its sentences. Readers need to connect a claim to the method and evidence that support it.', '2 Methods', 'Start with the reading map, then open the linked source passage. Translate one paragraph when needed, or translate the whole document with a local Ollama model.', '3 Results', 'Selecting a phrase opens tools for translation, explanation, highlighting, and notes. This practice document contains no measured results or claims about model accuracy.', '4 Limitations', 'A summary is a reading aid, not a substitute for evidence. PDF text extraction and local models can make mistakes; compare uncertain passages with the Original PDF when one is available.', '5 Conclusion', 'Keep useful passages in bookmarks, retain your notes, and export the material you want to revisit. This sample requires no model until you choose an AI action.'];
const markdownPlugins = [remarkGfm, remarkMath];
const markdownSchema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src || []), 'data'] }
};
const rehypePlugins = [rehypeRaw, [rehypeSanitize, markdownSchema], rehypeKatex];
const richHighlights = new Map();
const highlightColors = ['amber', 'teal', 'blue', 'coral'];
const currentHighlightColors = ['amber', 'teal', 'coral'];

function safeMarkdownUrl(url, key) { return key === 'src' && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(url) ? url : defaultUrlTransform(url); }
function refreshRichHighlights() {
  if (!CSS.highlights) return;
  for (const color of highlightColors) {
    const ranges = [...richHighlights.values()].flatMap(entry => entry[color] || []);
    if (ranges.length) CSS.highlights.set(`paperbridge-${color}`, new Highlight(...ranges));
    else CSS.highlights.delete(`paperbridge-${color}`);
  }
}
function markdownHighlightRanges(root, highlights) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('.katex-mathml')) continue;
    nodes.push({ node, start: nodes.length ? nodes.at(-1).end : 0, end: 0 });
    nodes.at(-1).end = nodes.at(-1).start + node.textContent.length;
  }
  const text = nodes.map(item => item.node.textContent).join('');
  const result = { amber: [], teal: [], blue: [], coral: [] };
  for (const highlight of highlights) {
    if (!result[highlight.color] || !highlight.text) continue;
    const first = text.indexOf(highlight.text);
    const displayAt = Number.isInteger(highlight.displayOffset) && text.slice(highlight.displayOffset, highlight.displayOffset + highlight.text.length) === highlight.text ? highlight.displayOffset : -1;
    const at = displayAt >= 0 ? displayAt : text.slice(highlight.offset, highlight.offset + highlight.text.length) === highlight.text ? highlight.offset : first >= 0 && first === text.lastIndexOf(highlight.text) ? first : -1;
    if (at < 0) continue;
    const start = nodes.find(item => item.end > at);
    const end = nodes.find(item => item.end >= at + highlight.text.length);
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(start.node, at - start.start);
    range.setEnd(end.node, at + highlight.text.length - end.start);
    result[highlight.color].push(range);
  }
  return result;
}
function Markdown({ children, highlights }) {
  const host = useRef(null);
  const highlightKey = useRef({});
  useEffect(() => {
    if (!highlights?.length || !host.current || !CSS.highlights) return;
    richHighlights.set(highlightKey.current, markdownHighlightRanges(host.current, highlights));
    refreshRichHighlights();
    return () => { richHighlights.delete(highlightKey.current); refreshRichHighlights(); };
  }, [children, highlights]);
  return <div ref={host} data-markdown-host><ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={rehypePlugins} urlTransform={safeMarkdownUrl}>{children || ''}</ReactMarkdown></div>;
}
function short(text, count = 92) { return text?.length > count ? `${text.slice(0, count)}…` : text; }
function domSelectionIn(root) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!root || !range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const raw = range.cloneContents().textContent || '';
  const text = raw.trim();
  if (!text || text.length > 3000) return null;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const offset = before.cloneContents().textContent.length + raw.length - raw.trimStart().length;
  const rect = range.getBoundingClientRect();
  return { text, offset, rect: { x: rect.left, y: rect.top }, context: root.textContent || '' };
}
function exactAnchorOffset(context, selection) {
  if (context.slice(selection.offset, selection.offset + selection.text.length) === selection.text) return selection.offset;
  const first = context.indexOf(selection.text);
  return first >= 0 && first === context.lastIndexOf(selection.text) ? first : null;
}
function textRangeAt(root, offset, length) {
  if (!root || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length <= 0) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
function viewText(paper, scope) {
  return scope === 'summarySource' ? paper.summary?.source || '' : scope === 'summaryTarget' ? paper.summary?.target || '' : scope === 'fullTranslation' ? paper.connectedTranslation || '' : '';
}
function validViewAnchor(paper, item) { return Number.isInteger(item.offset) && viewText(paper, item.scope).slice(item.offset, item.offset + item.text.length) === item.text; }
function isPdfScope(scope) { return scope === 'pdf' || scope === 'paperPdf'; }
function pdfAnnotationScope(item) { return item?.scope === 'paperPdf' ? 'paperPdf' : 'pdf'; }
function validPdfSelection(selection) { return isPdfScope(selection?.scope) && Number.isInteger(selection.page) && selection.page > 0 && Number.isInteger(selection.offset) && selection.pageText?.slice(selection.offset, selection.offset + selection.text.length) === selection.text; }
function validBlockAnchor(block, item, kind) { return Number.isInteger(item?.offset) && anchorText(block, kind).slice(item.offset, item.offset + item.text.length) === item.text; }
function blockAnnotationScope(item) { return item?.scope === 'paper' ? 'paper' : 'reader'; }
function blockAnnotationsFor(items, scope) { return (items || []).filter(item => blockAnnotationScope(item) === scope); }
function displayHighlightColor(color) { return color === 'blue' ? 'teal' : color; }
function highlightColorName(color) { return color === 'teal' ? 'Cobalt' : `${color[0].toUpperCase()}${color.slice(1)}`; }
function highlightMatchesSelection(item, selection) {
  if (!item || item.needsReview || !selection) return false;
  if (isPdfScope(selection.scope)) return pdfAnnotationScope(item) === selection.scope && item.page === selection.page && item.offset === selection.offset && item.text === selection.text;
  if (['summarySource', 'summaryTarget', 'fullTranslation'].includes(selection.scope)) return item.scope === selection.scope && item.offset === selection.offset && item.text === selection.text;
  return blockAnnotationScope(item) === selection.scope && item.offset === selection.offset && item.text === selection.text;
}
function selectionHighlights(paper, selection) {
  if (!paper || !selection) return [];
  if (isPdfScope(selection.scope)) return (paper.pdfHighlights || []).filter(item => highlightMatchesSelection(item, selection));
  if (['summarySource', 'summaryTarget', 'fullTranslation'].includes(selection.scope)) return (paper.viewHighlights || []).filter(item => highlightMatchesSelection(item, selection));
  const block = paper.blocks?.find(item => item.id === selection.id);
  const items = selection.kind === 'translation' ? block?.translationHighlights : block?.highlights;
  return (items || []).filter(item => highlightMatchesSelection(item, selection));
}
function markdownDocuments(paper) {
  const original = paper.blocks.map(block => block.sourceMarkdown || block.text).join('\n\n');
  const translated = paper.blocks.map(block => block.translationMarkdown || block.translation || (block.resource ? block.sourceMarkdown || block.text : `[Untranslated block ${block.id}]`)).join('\n\n');
  const bilingual = paper.blocks.map(block => {
    const source = block.sourceMarkdown || block.text;
    const target = block.translationMarkdown || block.translation || '*Not translated*';
    if (block.resource) return source;
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
async function sha256(value) { const bytes = new TextEncoder().encode(value); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''); }

function PdfView({ paper, pageNumber, highlights, navigation, onPage, onSelect, onNavigate, onNavigationFailure, onRendered, onOcr, onSetup, onReader }) {
  const canvas = useRef(null);
  const layer = useRef(null);
  const highlightKey = useRef({});
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState('');
  const [layerRevision, setLayerRevision] = useState(0);
  const [pageHasText, setPageHasText] = useState(null);
  useEffect(() => {
    let live = true;
    setPdf(null); setError('');
    if (paper?.type !== 'pdf') return;
    api.readPdf(paper.id).then(openPdf).then(value => { if (live) setPdf(value); }).catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [paper?.id, paper?.type]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let task;
    (async () => {
      setPageHasText(null);
      const page = await pdf.getPage(Math.max(1, Math.min(pageNumber, pdf.numPages)));
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const width = Math.min(850, Math.max(520, canvas.current.parentElement.clientWidth - 48));
      const viewport = page.getViewport({ scale: width / base.width });
      const surface = canvas.current;
      const ratio = window.devicePixelRatio || 1;
      surface.width = Math.round(viewport.width * ratio);
      surface.height = Math.round(viewport.height * ratio);
      surface.style.width = `${viewport.width}px`;
      surface.style.height = `${viewport.height}px`;
      if (layer.current) { layer.current.dataset.page = ''; layer.current.innerHTML = ''; layer.current.style.width = `${viewport.width}px`; layer.current.style.height = `${viewport.height}px`; }
      task = page.render({ canvasContext: surface.getContext('2d'), canvas: surface, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (cancelled || !layer.current) return;
      onRendered?.();
      try {
        const pdfjs = await import('pdfjs-dist');
        const textLayer = new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: layer.current, viewport });
        await textLayer.render();
        if (cancelled) return;
        layer.current.dataset.page = String(pageNumber);
        setPageHasText(Boolean(layer.current.textContent.trim()));
        setLayerRevision(previous => previous + 1);
      } catch { if (!cancelled) setPageHasText(false); /* canvas remains a faithful page preview */ }
    })().catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber]);
  useEffect(() => {
    const root = layer.current;
    if (!root || root.dataset.page !== String(pageNumber) || !CSS.highlights) return;
    const valid = (highlights || []).filter(item => item.page === pageNumber && root.textContent.slice(item.offset, item.offset + item.text.length) === item.text);
    richHighlights.set(highlightKey.current, markdownHighlightRanges(root, valid));
    refreshRichHighlights();
    return () => { richHighlights.delete(highlightKey.current); refreshRichHighlights(); };
  }, [highlights, pageNumber, layerRevision]);
  useEffect(() => {
    const root = layer.current;
    if (!navigation || navigation.page !== pageNumber || root?.dataset.page !== String(pageNumber)) return;
    const pageText = root.textContent || '';
    if (pageText.slice(navigation.offset, navigation.offset + navigation.text.length) !== navigation.text) { onNavigationFailure?.(); return; }
    const range = textRangeAt(root, navigation.offset, navigation.text.length);
    if (!range) { onNavigationFailure?.(); return; }
    const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    onNavigate?.({ text: navigation.text, offset: navigation.offset, page: navigation.page, pageText, context: pageText.slice(Math.max(0, navigation.offset - 300), navigation.offset + navigation.text.length + 300) });
  }, [navigation?.id, pageNumber, layerRevision]);
  if (paper?.type !== 'pdf') return <Empty title="No original PDF" body="This document was created from pasted text." />;
  return <div className="pdf-panel"><div className="pdf-toolbar"><span>Exact original PDF · page {pageNumber} of {pdf?.numPages || '…'}</span><div className="row"><button className="icon-button" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => onPage(pageNumber - 1)}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="Next page" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => onPage(pageNumber + 1)}><ChevronRight size={17} /></button></div></div>{pageHasText === false && <ScanNotice page ocrReady={paper.sourceMode === 'mineru' && paper.blocks.length > 0} onParse={onOcr} onSetup={onSetup} onReader={paper.blocks.length ? onReader : null} />}{error ? <Notice tone="error">{error}</Notice> : <div className="pdf-scroll" onMouseUp={event => {
    if (!event.target.closest('.textLayer')) return;
    const captured = domSelectionIn(layer.current);
    if (!captured || layer.current.textContent.slice(captured.offset, captured.offset + captured.text.length) !== captured.text) return;
    onSelect?.({ text: captured.text, offset: captured.offset, page: pageNumber, pageText: captured.context, context: captured.context.slice(Math.max(0, captured.offset - 300), captured.offset + captured.text.length + 300), rect: captured.rect });
  }}><div className="pdf-sheet"><canvas ref={canvas} /><div ref={layer} className="textLayer" /></div></div>}</div>;
}
function Empty({ title, body, children }) { return <div className="empty"><BookOpen size={36} strokeWidth={1.5} /><h2>{title}</h2><p>{body}</p>{children}</div>; }
function Notice({ children, tone = 'info', onClose }) { return <div className={`notice ${tone}`}><span>{children}</span>{onClose && <button className="icon-button" aria-label="Dismiss" onClick={onClose}><X size={15} /></button>}</div>; }
function TaskProgress({ busy, progress, failedCount }) {
  const total = Number.isFinite(progress?.total) && progress.total > 0 ? progress.total : null;
  const done = total === null ? null : Math.max(0, Math.min(total, progress.done || 0));
  return <div className="task-progress" role="status" aria-live="polite"><div className="task-progress-heading"><strong>{busy.label}</strong><span>{total === null ? 'Working…' : `${done} of ${total} processed`}{failedCount > 0 ? ` · ${failedCount} failed` : ''}</span></div><progress aria-label="Task progress" {...(total === null ? {} : { max: total, value: done })} /></div>;
}
function ScanNotice({ page = false, ocrReady = false, onParse, onSetup, onReader }) {
  return <div className="scan-notice" role="status"><AlertCircle size={20} /><div><strong>{page ? 'No selectable text on this PDF page' : 'No selectable text in this PDF'}</strong><p>{ocrReady ? 'MinerU OCR text is ready in Reader. The original PDF remains unchanged.' : 'The original page remains available. Use MinerU OCR to recover text before translating or summarizing it.'}</p><div className="row">{ocrReady ? <button className="button blue" onClick={onReader}>Open OCR Reader</button> : <><button className="button blue" onClick={onParse}>Parse with MinerU</button><button className="button outline" onClick={onSetup}>Set up local AI</button>{onReader && <button className="button ghost" onClick={onReader}>Open Reader</button>}</>}</div></div></div>;
}

function SummaryView({ paper, busy, summarize, navigate, onSelect }) {
  const claims = revalidateSummaryClaims(paper.summary?.claims, paper.blocks);
  return <div className="summary-view">
    <div className="section-heading"><div><h2>Paper summary</h2><p>Generated locally · verify each claim against the original</p></div><button className="button blue" disabled={!!busy || !paper.blocks.some(block => !block.heading && !block.resource)} onClick={summarize}><Sparkles size={16} /> {paper.summary ? 'Regenerate' : 'Generate summary'}</button></div>
    {paper.summary ? <>
      {paper.summary.stale && <Notice tone="error">The source text changed after this summary was generated. Regenerate before relying on it.</Notice>}
      <article className="summary-card" data-view-scope="summarySource" onMouseUp={event => onSelect(event, 'summarySource', 'source')}><small>{paper.summary.sourceLanguage}</small><Markdown highlights={(paper.viewHighlights || []).filter(item => item.scope === 'summarySource' && validViewAnchor(paper, item))}>{paper.summary.source}</Markdown></article>
      <article className="summary-card translated" data-view-scope="summaryTarget" onMouseUp={event => onSelect(event, 'summaryTarget', 'translation')}><small>{paper.summary.targetLanguage}</small><Markdown highlights={(paper.viewHighlights || []).filter(item => item.scope === 'summaryTarget' && validViewAnchor(paper, item))}>{paper.summary.target}</Markdown></article>
      <div className="source-links"><h3>Check the Sources</h3>
        {claims ? claims.map((claim, index) => <div className="evidence-claim" key={index}>
          <strong>Claim {index + 1}: {claim.sources.length ? `${claim.sources.length} exact source passage(s)` : 'No source link validated'}</strong>
          <p>{claim.text}</p>
          {claim.sources.length ? claim.sources.map((source, at) => <div key={`${source.paragraphID}-${at}`}><blockquote>{source.quote}</blockquote><button onClick={() => navigate(source.paragraphID)}>Read original block {source.paragraphID} →</button></div>) : <small>Check the original paper independently before treating this claim as evidence.</small>}
        </div>) : <p>This saved summary predates exact source links. Its claims have not been validated.</p>}
      </div>
    </> : <Empty title={paper.blocks.length ? 'No summary yet' : 'No readable text yet'} body={paper.blocks.length ? 'Generate a source and target language summary using your local model. Exact source quotations are linked only after validation.' : 'Use MinerU OCR from Paper or Original before summarizing this PDF.'} />}
  </div>;
}

function OverviewView({ paper, busy, summarize, navigate, onSelect, issues, onOriginal, onReader, translatedCount, paragraphCount }) {
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
    <SummaryView paper={paper} busy={busy} summarize={summarize} navigate={navigate} onSelect={onSelect} />
  </div>;
}

function PaperPreview({ paper, displayMode, onSelect }) {
  const structured = paper.sourceMode === 'mineru' && Boolean(paper.mineruMarkdown);
  const blocks = paper.blocks;
  const renderText = (block, kind) => {
    const translation = kind === 'translation';
    const markdown = translation ? block.translationMarkdown : block.sourceMarkdown;
    const text = translation ? block.translation : block.text;
    const highlights = blockAnnotationsFor(translation ? block.translationHighlights : block.highlights, 'paper');
    return structured && markdown ? <Markdown highlights={highlights}>{markdown}</Markdown> : block.heading ? <h3>{withHighlight(text, highlights)}</h3> : <p>{withHighlight(text, highlights)}</p>;
  };
  const select = event => {
    const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
    const start = range?.startContainer?.nodeType === Node.ELEMENT_NODE ? range.startContainer : range?.startContainer?.parentElement;
    onSelect(event, 'paper', start?.closest('[data-paper-kind]')?.dataset.paperKind || 'source');
  };
  return <article className={`document-preview paper-mode-${displayMode}`} onMouseUp={select}>
    {blocks.map(block => { const translated = block.status === 'ok' && Boolean(block.translation || block.translationMarkdown); const sourceOnlyFallback = displayMode === 'translation' && (!translated || block.resource); return <section className="paper-preview-block" data-paper-block-id={block.id} key={block.id}>
      {(displayMode !== 'translation' || sourceOnlyFallback) && <div className={sourceOnlyFallback ? 'paper-preview-source unavailable' : 'paper-preview-source'} data-paper-kind="source">{renderText(block, 'source')}</div>}
      {displayMode !== 'source' && !block.resource && (translated
        ? <div className="paper-preview-translation" data-paper-kind="translation">{renderText(block, 'translation')}</div>
        : displayMode === 'bilingual' && <div className="paper-preview-translation unavailable"><p>Translation unavailable</p></div>)}
    </section>; })}
  </article>;
}

function LibraryView({ items, query, setQuery, loadPaper, setModal, setError, setLibraryEdit }) {
  return <>
    <input placeholder="Search titles and tags" value={query} onChange={event => setQuery(event.target.value)} />
    {items.map(item => <div className="library-entry" key={item.id}>
      <button className="modal-list-row" onClick={() => { loadPaper(item.id).catch(cause => setError(cause.message)); setModal(''); }}><BookOpen size={17} /><span><b>{item.name}</b><small>{item.blockCount} blocks · {item.updatedAt?.slice(0, 10)}{item.tags?.length ? ` · ${item.tags.join(', ')}` : ''}</small></span></button>
      <button className="icon-button" aria-label={`Edit label for ${item.name}`} onClick={() => { setLibraryEdit({ id: item.id, name: item.name, tags: (item.tags || []).join(', ') }); setModal('libraryLabel'); }}><Pencil size={16} /></button>
    </div>)}
    {!items.length && <p>No matching papers.</p>}
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
    {viewNotes.map(note => <div className="annotation-row" key={note.id}><button onClick={() => navigateView(note)}><b>{note.scope}{validViewAnchor(paper, note) ? '' : ' · source changed, review needed'}</b><span>{short(note.text, 90)}</span><small>{short(note.body, 110)}</small></button><button className="icon-button" aria-label={`Delete view note ${note.id}`} onClick={() => removeViewNote(note.id)}><Trash2 size={14} /></button></div>)}
    {viewHighlights.map(highlight => <div className="annotation-row" key={highlight.id}><button onClick={() => navigateView(highlight)}><b>{highlight.scope} · {highlight.color}{validViewAnchor(paper, highlight) ? '' : ' · source changed, review needed'}</b><span>{short(highlight.text, 90)}</span></button><button className="icon-button" aria-label={`Remove view highlight ${highlight.id}`} onClick={() => removeViewHighlight(highlight.id)}><Trash2 size={14} /></button></div>)}
    {pdfNotes.map(note => <div className="annotation-row" key={note.id}><button onClick={() => navigatePdf(note)}><b>{pdfAnnotationScope(note) === 'paperPdf' ? 'Paper · exact PDF' : 'Original PDF'} · page {note.page}{note.needsReview ? ' · source changed, review needed' : ''}</b><span>{short(note.text, 90)}</span><small>{short(note.body, 110)}</small></button><button className="icon-button" aria-label={`Delete PDF note ${note.id}`} onClick={() => removePdfNote(note.id)}><Trash2 size={14} /></button></div>)}
    {pdfHighlights.map(highlight => <div className="annotation-row" key={highlight.id}><button onClick={() => navigatePdf(highlight)}><b>{pdfAnnotationScope(highlight) === 'paperPdf' ? 'Paper · exact PDF' : 'Original PDF'} · page {highlight.page} · {highlight.color} highlight{highlight.needsReview ? ' · source changed, review needed' : ''}</b><span>{short(highlight.text, 90)}</span></button><button className="icon-button" aria-label={`Remove PDF highlight ${highlight.id}`} onClick={() => removePdfHighlight(highlight.id)}><Trash2 size={14} /></button></div>)}
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

function QuickSelection({ selection, results, busy, lookup, activeColor, quickTermOpen, termDraft, setTermDraft, onTranslate, onExplain, onHighlight, onRemoveHighlight, onOpenTerm, onSaveTerm, onCancelTerm, onMore, onCancelTask, onClose }) {
  return <div className="selection-toolbar" role="dialog" aria-label="Quick selection" onMouseDown={event => { if (!event.target.closest('input')) event.preventDefault(); }}>
    <div className="quick-selection-head"><strong>{short(selection.text, 150)}</strong><button aria-label="Close quick lookup" onClick={onClose}><X size={14} /></button></div>
    <div className="quick-selection-actions"><button disabled={!!busy} onClick={onTranslate}><Languages size={14} /> Translate</button><button disabled={!!busy} onClick={onExplain}><Sparkles size={14} /> Explain</button></div>
    {busy && <div className="quick-selection-busy"><span>{busy.label}</span><button onClick={onCancelTask}>Cancel</button></div>}
    <SelectionResults results={results} />
    {!busy && lookup?.error && <p className="selection-lookup-message error" role="alert">{lookup.error}</p>}
    {!busy && !lookup?.error && lookup?.status && <p className="selection-lookup-message">{lookup.status}</p>}
    <div className="quick-highlight-row"><span>Highlight</span><HighlightControls activeColor={activeColor} onAdd={onHighlight} onRemove={onRemoveHighlight} compact /></div>
    {quickTermOpen ? <div className="quick-term"><input aria-label="Preferred translation" placeholder="Preferred translation" value={termDraft} onChange={event => setTermDraft(event.target.value)} /><div className="row"><button disabled={!termDraft.trim()} onClick={onSaveTerm}>Save Term</button><button onClick={onCancelTerm}>Cancel</button></div></div> : <div className="quick-selection-foot"><button disabled={selection.text.length > 160} onClick={onOpenTerm}>Save Term…</button><button onClick={onMore}><MessageSquareText size={14} /> Notes & More</button></div>}
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
  const [library, setLibrary] = useState([]);
  const [paper, setPaper] = useState(null);
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
  const [status, setStatus] = useState('Open a PDF or try the practice paper.');
  const [error, setError] = useState('');
  const [workspaceSave, setWorkspaceSave] = useState({ status: 'idle', error: null });
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(null);
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

  const commitPaper = (updater, { delay = 0, deferUndo = false } = {}) => {
    const current = paperRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (next === current) return current;
    if (pendingUndoSnapshot.current && !deferUndo) {
      const entry = createUndoEntry(pendingUndoSnapshot.current, next);
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
    let block = activeBlock;
    if (tab === 'Reader' && !search && mainScrollRef.current) {
      const top = mainScrollRef.current.getBoundingClientRect().top;
      const visible = [...mainScrollRef.current.querySelectorAll('.reader-list > .block')].find(element => element.getBoundingClientRect().bottom > top + 12);
      if (visible) block = Number(visible.id.replace('block-', ''));
    }
    return { paperId: current.id, tab, displayMode, block, page: pageNumber, search, scrollByTab };
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
  function resetReadingHistory() {
    readingHistory.current.reset();
    readingRestoration.current++;
    clearTimeout(scrollSaveTimer.current);
    syncReadingHistory();
  }
  function restoreReadingLocation(location) {
    if (!location || location.paperId !== paperRef.current?.id) return;
    void finishNoteEditing();
    clearTimeout(scrollSaveTimer.current);
    const generation = ++readingRestoration.current;
    restoringScroll.current = true;
    searchOrigin.current = null;
    setSelection(null); setSelectionResults({}); setPdfNavigation(null); setViewNavigation(null); setBlockNavigation(null);
    setTab(location.tab); setDisplayMode(location.displayMode); setActiveBlock(location.block); setPageNumber(location.page); setSearch(location.search);
    commitPaper(current => ({ ...current, position: { ...current.position, tab: location.tab, displayMode: location.displayMode, block: location.block, page: location.page, scrollByTab: { ...location.scrollByTab } } }));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== readingRestoration.current) return;
      const key = scrollKey(location.tab, location.page);
      const saved = location.scrollByTab?.[key];
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = Number(saved || 0);
      if (saved == null && location.tab === 'Reader') document.getElementById(`block-${location.block}`)?.scrollIntoView({ block: 'start' });
      restoringScroll.current = false;
    }));
  }
  function goBackInReading() {
    const destination = readingHistory.current.goBack(currentReadingLocation());
    syncReadingHistory();
    restoreReadingLocation(destination);
  }
  function goForwardInReading() {
    const destination = readingHistory.current.goForward(currentReadingLocation());
    syncReadingHistory();
    restoreReadingLocation(destination);
  }
  function navigateToTab(target) {
    if (!paperRef.current || target === tab) return;
    recordReadingJump();
    setTab(target);
  }
  const loadPaper = async (item, { fromImport = false, token = null } = {}) => {
    if ((busy || taskRef.current) && !fromImport) { setError('Finish or stop the current task before opening another paper.'); return; }
    if (!await finishNoteEditing()) { setError('The current paper could not be saved. Retry before opening another paper.'); return; }
    let loaded = typeof item === 'string' ? await api.loadPaper(item) : item;
    if (token) requireActiveTask(token);
    if (!loaded) throw new Error('Paper could not be loaded.');
    loaded = { ...loaded, paragraphExplanations: migrateExplanations(loaded, loaded.taskSettings ? restorePaperSettings(settingsRef.current, loaded.taskSettings) : null) };
    if (loaded.taskSettings) {
      const previous = settingsRef.current;
      const restored = restorePaperSettings(previous, loaded.taskSettings);
      settingsRef.current = restored; setSettings(restored);
      if (previous?.ollamaBaseURL !== restored.ollamaBaseURL) { setModels([]); setOllamaError('Checking the restored local endpoint…'); refreshModels(restored); }
    }
    resetReadingHistory();
    paperRef.current = loaded; setPaper(loaded); setUndo([]); setTab(loaded.position?.tab || 'Paper'); setDisplayMode(loaded.position?.displayMode || 'bilingual'); setExplanationLanguage(languages.includes(loaded.explanationLanguage) ? loaded.explanationLanguage : 'English'); setInspector(loaded.inspectorOpen ?? inspector); setSelection(null); setPdfNavigation(null); setViewNavigation(null); setBlockNavigation(null); setSearch(''); setActiveBlock(loaded.position?.block || 1); setPageNumber(loaded.position?.page || 1); setStatus(loaded.taskSettings ? `Opened ${loaded.name}.` : `Opened ${loaded.name}. This older paper has no saved task settings; check its languages and models before continuing.`);
  };
  const updateBlock = (id, change) => commitPaper(current => ({ ...current, blocks: current.blocks.map(block => block.id === id ? { ...block, ...change } : block) }));
  const updateSettings = change => {
    const previous = settingsRef.current;
    const taskChanged = Object.keys(change).some(key => TASK_SETTING_KEYS.includes(key) && change[key] !== previous[key]);
    if (taskChanged && taskRef.current) cancelTask();
    const next = { ...previous, ...change };
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
    setNoteDraft(findSelectionNote(restored, selectionRef.current)?.body || '');
    setUndo(previous => previous.slice(0, -1));
  }
  const restoreMainScroll = () => {
    const generation = readingRestoration.current;
    restoringScroll.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== readingRestoration.current) return;
      const key = tab === 'Original' ? `Original:${pageNumber}` : tab;
      const saved = paperRef.current?.position?.scrollByTab?.[key];
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = Number(saved || 0);
      if (saved == null && tab === 'Reader') document.getElementById(`block-${activeBlock}`)?.scrollIntoView({ block: 'start' });
      restoringScroll.current = false;
    }));
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
      searchOrigin.current = null;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (mainScrollRef.current) mainScrollRef.current.scrollTop = offset; }));
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
      refreshModels(currentSettings);
      api.graphicsStatus().then(setHardware).catch(() => {});
      api.mineruRuntime(currentSettings.mineruExecutable).then(setMineruRuntime).catch(() => {});
    }).catch(err => setError(err.message));
    const off = api.onProgress(data => { if (data.kind === 'setup') setSetupProgress(data); else if (data.kind === 'model') setPullProgress(data); else setStatus(data.status || 'MinerU is processing the PDF…'); });
    return off;
  }, []);
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
  useEffect(() => { if (paper?.id) { const id = paper.id; saveQueue.current.flush().then(saved => saved && api.markPaperOpened(id)).catch(cause => setError(cause.message)); } }, [paper?.id]);
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
  useEffect(() => { if (ready) api.saveGlossary(glossary).catch(err => setError(err.message)); }, [glossary, ready]);
  useEffect(() => { if (paperRef.current && paperRef.current.position?.tab !== tab) commitPaper(current => ({ ...current, position: { ...current.position, tab } })); }, [tab]);
  useEffect(() => { if (paperRef.current && !focus && paperRef.current.inspectorOpen !== inspector) commitPaper(current => ({ ...current, inspectorOpen: inspector })); }, [inspector, paper?.id, focus]);
  useEffect(() => {
    void finishNoteEditing();
    setSelection(null); setSelectionResults({});
  }, [tab, paper?.id]);
  useEffect(() => {
    if (!viewNavigation || !paper || tab !== (viewNavigation.scope === 'fullTranslation' ? 'Full Translation' : 'Summary')) return;
    const host = document.querySelector(`[data-view-scope="${viewNavigation.scope}"] [data-markdown-host]`);
    if (!host) return;
    const source = host.textContent || '';
    const savedOffset = viewNavigation.displayOffset;
    const exact = Number.isInteger(savedOffset) && source.slice(savedOffset, savedOffset + viewNavigation.text.length) === viewNavigation.text ? savedOffset : null;
    const first = source.indexOf(viewNavigation.text);
    const offset = exact ?? (first >= 0 && first === source.lastIndexOf(viewNavigation.text) ? first : null);
    const range = offset === null || !validViewAnchor(paper, viewNavigation) ? null : textRangeAt(host, offset, viewNavigation.text.length);
    if (!range) { setError('The saved Markdown text no longer matches this view. The annotation was kept for review.'); setViewNavigation(null); return; }
    const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    setSelection({ ...viewNavigation, id: null, kind: viewNavigation.scope === 'summarySource' ? 'source' : 'translation', displayOffset: offset, rect: null });
    setSelectionResults({}); setNoteDraft(findSelectionNote(paper, viewNavigation)?.body || ''); setInspector(true); setViewNavigation(null);
  }, [viewNavigation?.id, tab, paper?.id]);
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
      else if (tab === 'Full Translation') { if (!paper.connectedTranslation || paper.connectedStale) fullTranslation(!!paper.connectedTranslation); }
      else if (paper.blocks.some(block => block.status !== 'ok')) translateBlocks(paper.blocks.map(block => block.id));
    }
    else if (name === 'generateSummary') { if (paper && !busy) { setTab('Summary'); summarize(); } }
    else if (name === 'generateFullTranslation') { if (paper && !busy) { setTab('Full Translation'); fullTranslation(!!paper.connectedTranslation); } }
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
    const saved = await finishNoteEditing();
    if (saved) api.closeReady();
    else {
      setError('PaperBridge kept this window open because the latest paper changes could not be saved. Retry the save, then close again.');
      api.closeCancelled();
    }
  }), []);
  useEffect(() => { if (paper) restoreMainScroll(); }, [tab, paper?.id]);
  useEffect(() => {
    const targetTab = blockNavigation?.scope === 'paper' ? 'Paper' : 'Reader';
    if (!blockNavigation || !paper || tab !== targetTab) return;
    let cancelled = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled || paperRef.current?.id !== paper.id) return;
      const request = blockNavigation;
      const block = paperRef.current.blocks.find(item => item.id === request.blockId);
      const root = request.scope === 'paper'
        ? document.querySelector(`[data-paper-block-id="${request.blockId}"] [data-paper-kind="${request.kind}"]`)
        : document.querySelector(`[data-block-id="${request.blockId}"][data-kind="${request.kind}"]`);
      const rendered = root?.textContent || '';
      const displayAt = Number.isInteger(request.displayOffset) && rendered.slice(request.displayOffset, request.displayOffset + request.text.length) === request.text ? request.displayOffset : null;
      const sourceAt = Number.isInteger(request.offset) && rendered.slice(request.offset, request.offset + request.text.length) === request.text ? request.offset : null;
      const first = rendered.indexOf(request.text);
      const at = displayAt ?? sourceAt ?? (first >= 0 && first === rendered.lastIndexOf(request.text) ? first : null);
      const range = block && validBlockAnchor(block, request, request.kind) && at !== null ? textRangeAt(root, at, request.text.length) : null;
      if (!range) {
        commitPaper(current => ({ ...current, blocks: current.blocks.map(item => item.id !== request.blockId ? item : request.recordType === 'note'
          ? { ...item, notes: (item.notes || []).map(note => note.id === request.id ? { ...note, needsReview: true } : note) }
          : { ...item, [request.kind === 'translation' ? 'translationHighlights' : 'highlights']: (item[request.kind === 'translation' ? 'translationHighlights' : 'highlights'] || []).map(highlight => (request.id ? highlight.id === request.id : highlight.text === request.text && highlight.offset === request.offset && highlight.color === request.color && blockAnnotationScope(highlight) === request.scope) ? { ...highlight, needsReview: true } : highlight) }) }));
        setError(`The saved ${request.scope === 'paper' ? 'Paper' : 'Reader'} text no longer matches this block. The annotation was kept for review.`);
        setBlockNavigation(null);
        return;
      }
      const selected = window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
      range.startContainer.parentElement?.scrollIntoView({ block: 'center' });
      const nextSelection = { id: block.id, kind: request.kind, text: request.text, offset: request.offset, displayOffset: at, scope: request.scope, rect: null, context: rendered.slice(Math.max(0, at - 300), at + request.text.length + 300) };
      setSelection(nextSelection);
      setSelectionResults({}); setNoteDraft(findSelectionNote(paperRef.current, nextSelection)?.body || ''); setInspector(true); setBlockNavigation(null);
    }));
    return () => { cancelled = true; };
  }, [blockNavigation?.requestId, tab, displayMode, paper?.id]);
  useEffect(() => () => clearTimeout(scrollSaveTimer.current), []);

  async function openFile() {
    if (taskRef.current) return;
    const token = startTask('Opening PDF…');
    try {
      const imported = await api.importPdf();
      if (!imported) return;
      requireActiveTask(token);
      await ingestPdf(imported, token);
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function dropPdf(event) {
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    if (modal) return;
    if (taskRef.current) { setError('Finish or stop the current task before opening another paper.'); return; }
    const file = files.find(item => /\.pdf$/i.test(item.name));
    if (!file) { setError('Drop a PDF file to open it.'); return; }
    const token = startTask('Opening dropped PDF…');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      requireActiveTask(token);
      const imported = await api.importPdfBytes({ name: file.name, bytes });
      requireActiveTask(token);
      await ingestPdf(imported, token);
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function ingestPdf(imported, token) {
      requireActiveTask(token);
      if (imported.existing) { await loadPaper(imported.existing, { fromImport: true, token }); return; }
      const pdf = await openPdf(imported.bytes);
      try {
      requireActiveTask(token);
      const mode = settings.pdfExtractionMode || 'mineruPreferred';
      let mineruMarkdown = '';
      let warning = '';
      if (mode !== 'pdfOnly') {
        const mineru = await api.mineruStatus(settings.mineruExecutable);
        requireActiveTask(token);
        if (mineru.compatible) {
          setBusy({ label: 'MinerU is reconstructing the paper…' });
          try { mineruMarkdown = await api.extractMineru({ id: imported.id, executable: mineru.executable, backend: settings.mineruBackend }); }
          catch (cause) { requireActiveTask(token); if (mode === 'mineruOnly') throw cause; warning = `MinerU failed: ${cause.message}. Using the selectable PDF text layer.`; }
        } else if (mode === 'mineruOnly') throw new Error('MinerU-only mode requires a working MinerU 3.x installation. Open Local AI setup.');
      }
      requireActiveTask(token);
      setBusy({ label: 'Reading PDF text layer…' });
      const pdfBlocks = await extractPdf(pdf, (done, total) => { requireActiveTask(token); setProgress({ done, total }); }, () => requireActiveTask(token));
      requireActiveTask(token);
      const mineruBlocks = mineruMarkdown ? parsedMarkdownBlocks(mineruMarkdown) : [];
      const useMineru = mineruBlocks.length > 0;
      if (mineruMarkdown && !useMineru) warning = `MinerU returned no readable blocks.${mode === 'mineruOnly' ? ' The original PDF remains available.' : ' Using the selectable PDF text layer if present.'}`;
      const blocks = useMineru ? mineruBlocks : mode === 'mineruOnly' ? [] : pdfBlocks;
      const document = { id: imported.id, name: imported.name, type: 'pdf', createdAt: new Date().toISOString(), blocks, pdfBlocks, mineruBlocks: useMineru ? mineruBlocks : null, mineruMarkdown: useMineru ? mineruMarkdown : '', sourceMode: useMineru ? 'mineru' : 'pdf', tags: [], summary: null, connectedTranslation: '', taskSettings: snapshotPaperSettings(settingsRef.current), explanationLanguage: 'English', paragraphExplanations: {}, inspectorOpen: inspector, position: { block: 1, page: 1, tab: 'Paper', displayMode: 'bilingual' }, extraction: useMineru ? 'MinerU' : 'PDF.js' };
      resetReadingHistory();
      setUndo([]); commitPaper(document); setTab('Paper'); setDisplayMode('bilingual'); setExplanationLanguage('English'); setActiveBlock(1); setPageNumber(1); setSearch('');
      setStatus(warning || (blocks.length ? `Extracted ${blocks.length} blocks from ${pdf.numPages} pages. Compare uncertain passages with Original PDF.` : 'No selectable text found. The exact original PDF is available; use MinerU for OCR.'));
      } finally { await pdf.destroy(); }
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
  function endTask(token) { if (taskRef.current === token) { taskRef.current = null; setBusy(null); setProgress(null); } }
  async function generate(model, prompt, system, token, format) {
    requireActiveTask(token);
    const requestId = crypto.randomUUID(); token.ids.add(requestId);
    try { const answer = await api.generate({ baseURL: settings.ollamaBaseURL, model, prompt, system, requestId, format }); requireActiveTask(token); return answer; }
    finally { token.ids.delete(requestId); }
  }
  function cancelTask() { const token = taskRef.current; if (!token) return; token.cancelled = true; for (const id of token.ids) api.cancel(id).catch(() => {}); api.cancelMineru().catch(() => {}); taskRef.current = null; setBusy(null); setProgress(null); if (token.kind === 'selection') setSelectionLookup({ status: 'Quick lookup cancelled.', error: '' }); setStatus('Task cancelled. Completed work was saved.'); }
  function matchingTerms(text, from = settings.sourceLanguage, to = settings.targetLanguage) { return glossary.filter(term => term.sourceLanguage === from && term.targetLanguage === to && text.toLowerCase().includes(term.source.toLowerCase())).slice(0, 24); }
  async function translateBlocks(ids) {
    if (!paperRef.current || busy || taskRef.current) return;
    const token = startTask('Translating paragraphs…');
    const references = referenceBlockIds(paperRef.current.blocks);
    const eligible = new Set(translationRangeIds(paperRef.current.blocks, ids, references));
    const queue = paperRef.current.blocks.filter(block => eligible.has(block.id));
    if (!queue.length) { setStatus('This range is already complete.'); endTask(token); return; }
    translationQueueRef.current = { token, queue, next: 0 };
    try {
      if (settings.sourceLanguage !== settings.targetLanguage && !models.includes(settings.translationModel)) throw new Error(`Install ${settings.translationModel} in Ollama first.`);
      for (let index = 0; index < queue.length; index++) {
        if (token.cancelled) break;
        const block = queue[index];
        translationQueueRef.current.next = index + 1;
        setBusy({ label: `Translating block ${block.id} · ${index + 1} of ${queue.length}` }); setProgress({ done: index, total: queue.length });
        try {
          const protectedBlock = block.sourceMarkdown ? protectMarkdown(block.sourceMarkdown) : null;
          const parts = chunkText(protectedBlock?.text || block.text, Number(settings.maxParagraphChars) || 1800);
          const translated = [];
          for (const part of parts) translated.push(settings.sourceLanguage === settings.targetLanguage ? part : await generate(settings.translationModel, protectedBlock ? markdownTranslationPrompt(part, settings.sourceLanguage, settings.targetLanguage, matchingTerms(part)) : translationPrompt(part, settings.sourceLanguage, settings.targetLanguage, matchingTerms(part)), translationSystem(settings.targetLanguage), token));
          const output = protectedBlock ? restoreMarkdown(translated.join('\n'), protectedBlock.tokens) : translated.join(' ');
          if (!token.cancelled) updateBlock(block.id, { translation: output, translationMarkdown: protectedBlock ? output : null, status: 'ok', error: '' });
        } catch (err) { if (token.cancelled) break; updateBlock(block.id, { status: 'failed', error: err.message }); }
        setProgress({ done: index + 1, total: queue.length });
      }
      if (!token.cancelled) setStatus(`Translation pass finished. ${paperRef.current.blocks.filter(block => block.status === 'ok' && !block.resource && !references.has(block.id)).length} blocks saved.`);
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
    const block = paperRef.current.blocks.find(item => item.id === selection.id);
    const context = isPdfScope(selection.scope) ? selection.context || '' : (selection.kind === 'translation' ? block?.translation : block?.text) || selection.context || '';
    const model = settings.quickLookupModel || (kind === 'translate' ? settings.translationModel : settings.explainModel);
    const from = selection.kind === 'translation' ? settings.targetLanguage : settings.sourceLanguage;
    const to = selection.kind === 'translation' ? settings.sourceLanguage : settings.targetLanguage;
    const selectedKey = selectionIdentity(selection);
    const cacheKey = JSON.stringify([paperRef.current.id, kind, selectedKey, context, from, to, model, settings.ollamaBaseURL, explanationLanguage, matchingTerms(selection.text, from, to)]);
    if (lookupCache.current.has(cacheKey)) { setSelectionResults(current => ({ ...current, [kind]: lookupCache.current.get(cacheKey) })); setSelectionLookup({ status: 'Using cached quick lookup.', error: '' }); return; }
    setSelectionLookup({ status: '', error: '' });
    const token = startTask(kind === 'translate' ? 'Translating selection…' : 'Explaining selection…');
    token.kind = 'selection'; token.selectionKey = selectedKey;
    try {
      const output = kind === 'translate'
         ? await generate(model, translationPrompt(selection.text, from, to, matchingTerms(selection.text, from, to)), translationSystem(to), token)
         : await generate(model, explainPrompt(selection.text, context, explanationLanguage), 'You are a patient academic explainer. Explain accurately and simply.', token);
      if (!token.cancelled && selectionIdentity(selectionRef.current) === selectedKey) { lookupCache.current.set(cacheKey, output); setSelectionResults(current => ({ ...current, [kind]: output })); setSelectionLookup({ status: kind === 'translate' ? 'Selection translated.' : 'Selection explained.', error: '' }); }
    } catch (err) { if (!token.cancelled) { setSelectionLookup({ status: '', error: err.message }); setError(err.message); } } finally { endTask(token); }
  }
  async function reextractAsNew() {
    if (paper?.type !== 'pdf' || busy || taskRef.current) return;
    setModal(''); const token = startTask('Creating a new extraction…');
    try { await ingestPdf(await api.copyPdfAsNew({ id: paper.id, name: paper.name }), token); }
    catch (cause) { if (!token.cancelled) setError(cause.message); }
    finally { endTask(token); }
  }
  async function explainBlock(id) {
    const block = paperRef.current?.blocks.find(item => item.id === id);
    if (!block || busy || taskRef.current) return;
    const token = startTask(`Explaining block ${id}…`);
    try {
      const output = await generate(settings.explainModel, explainPrompt(block.text, block.text, explanationLanguage), 'Explain this whole academic paragraph accurately and simply.', token);
      if (!token.cancelled) {
        const settingsKey = explanationKey(id, explanationLanguage, settings);
        const result = { id, language: explanationLanguage, source: block.text, output, settingsKey };
        commitPaper(current => ({ ...current, paragraphExplanations: { ...current.paragraphExplanations, [settingsKey]: result } }));
        setInspector(true);
      }
    } catch (cause) { if (!token.cancelled) setError(cause.message); } finally { endTask(token); }
  }
  async function summarize() {
    if (!paperRef.current || busy || taskRef.current) return;
    if (!paperRef.current.blocks.some(block => !block.heading && !block.resource)) { setError('No readable text to summarize. Use MinerU OCR first.'); return; }
    const token = startTask('Summarizing paper…');
    try {
      const references = referenceBlockIds(paperRef.current.blocks);
      const source = paperRef.current.blocks.filter(block => !block.heading && !block.resource && !references.has(block.id));
      const batches = []; let batch = []; let length = 0;
      for (const block of source) { if (length + block.text.length > 6000 && batch.length) { batches.push(batch); batch = []; length = 0; } batch.push(block); length += block.text.length; }
      if (batch.length) batches.push(batch);
      const partials = [];
      const validatedPartials = [];
      async function withExactQuotes(response, claims, eligible, allowedSources = null) {
        const candidates = summarySourceCandidates(response, eligible);
        const allowed = allowedSources && new Set(allowedSources.map(item => `${item.paragraphID}|${item.quote}`));
        const byId = new Map(eligible.map(block => [block.id, block]));
        for (let index = 0; index < claims.length; index++) {
          if (token.cancelled || claims[index].sources.length) continue;
          for (const id of candidates[index] || []) {
            const block = byId.get(id);
            if (!block) continue;
            const answer = await generate(settings.summaryModel, summaryQuotePrompt(claims[index].text, id, block.text), 'Select only an exact supporting quote from the supplied paragraph, or return NONE.', token);
            const quote = answer.trim().replace(/^["“‘]|["”’]$/g, '');
            if (quote.length >= 20 && quote.length <= 500 && block.text.includes(quote) && (!allowed || allowed.has(`${id}|${quote}`))) {
              claims[index] = { ...claims[index], sources: [{ paragraphID: id, quote }] };
              break;
            }
          }
        }
        return claims;
      }
      for (let i = 0; i < batches.length; i++) {
        if (token.cancelled) return;
        setBusy({ label: `Summarizing part ${i + 1} of ${batches.length}` }); setProgress({ done: i, total: batches.length + 1 });
        const response = await generate(settings.summaryModel, summaryPrompt(batches[i], settings.sourceLanguage), 'You are a careful academic paper assistant. Return only the requested JSON.', token, 'json');
        partials.push(response);
        const claims = parseSummaryClaims(response, paperRef.current.blocks, null, batches[i].map(block => `[P${block.id}]\n${block.text}`).join('\n\n'));
        validatedPartials.push(...await withExactQuotes(response, claims, batches[i]));
        setProgress({ done: i + 1, total: batches.length + 1 });
      }
      const merged = partials.length === 1 ? partials[0] : await generate(settings.summaryModel, mergeSummaryPrompt(validatedPartials, settings.sourceLanguage), 'You are a careful academic paper assistant. Return only the requested JSON.', token, 'json');
      const allowedSources = partials.length === 1 ? null : validatedPartials.flatMap(claim => claim.sources);
      const claims = partials.length === 1 ? validatedPartials : await withExactQuotes(merged, parseSummaryClaims(merged, paperRef.current.blocks, allowedSources), source, allowedSources);
      if (!claims.length) throw new Error('The summary model returned no usable claims; the saved summary was not replaced.');
      const sourceSummary = claimsMarkdown(claims);
      const targetSummary = settings.sourceLanguage === settings.targetLanguage ? sourceSummary : await generate(settings.translationModel, translationPrompt(sourceSummary, settings.sourceLanguage, settings.targetLanguage), translationSystem(settings.targetLanguage), token);
      if (!token.cancelled) { commitPaper(current => ({ ...current, summary: { source: sourceSummary, target: targetSummary, claims, sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage } })); setStatus('Summary saved. Only exact-match source quotations are linked.'); }
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function fullTranslation(force = false) {
    if (!paperRef.current || busy || taskRef.current) return;
    if (!paperRef.current.blocks.some(block => !block.heading && !block.resource)) { setError('No readable text to translate. Use MinerU OCR first.'); return; }
    const token = startTask('Translating full paper…');
    try {
      const blocks = paperRef.current.blocks;
      const references = referenceBlockIds(blocks);
      const previous = paperRef.current.connectedBlocks || [];
      const outputs = [];
      for (let i = 0; i < blocks.length; i++) {
        if (token.cancelled) return;
        const block = blocks[i];
        const source = block.sourceMarkdown || block.text;
        setBusy({ label: `Translating full paper · ${i + 1} of ${blocks.length}` }); setProgress({ done: i, total: blocks.length });
        let output = source;
        let status = 'ok';
        if (!references.has(block.id) && !block.resource && settings.sourceLanguage !== settings.targetLanguage) {
          const saved = previous[i];
          if (!force && saved?.source === source && saved?.status === 'ok') output = saved.output;
          else {
            try {
              const protectedBlock = block.sourceMarkdown ? protectMarkdown(source) : null;
              const parts = chunkText(protectedBlock?.text || source, 4800);
              const context = outputs.slice(-2).map(item => item.output).join('\n\n').slice(-800);
              const translated = [];
              for (const part of parts) {
                const prompt = block.sourceMarkdown ? markdownTranslationPrompt(part, settings.sourceLanguage, settings.targetLanguage, matchingTerms(part)) : translationPrompt(part, settings.sourceLanguage, settings.targetLanguage, matchingTerms(part));
                translated.push(await generate(settings.translationModel, `${context ? `Previous translated context for terminology only:\n${context}\n\n` : ''}${prompt}`, translationSystem(settings.targetLanguage), token));
              }
              output = protectedBlock ? restoreMarkdown(translated.join('\n'), protectedBlock.tokens) : translated.join(' ');
            } catch (cause) { if (token.cancelled) return; status = 'failed'; setStatus(`Full translation block ${block.id} failed: ${cause.message}. Original text retained.`); }
          }
        }
        outputs.push({ id: block.id, source, output, status });
        commitPaper(current => ({ ...current, connectedBlocks: [...outputs], connectedTranslation: outputs.map(item => item.output).join('\n\n'), connectedStale: i < blocks.length - 1 }));
        setProgress({ done: i + 1, total: blocks.length });
      }
      setStatus(`Connected full-paper translation saved. ${outputs.filter(item => item.status === 'failed').length} block(s) retained in the original language.`);
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function runMineru() {
    if (!paper || paper.type !== 'pdf' || busy || mineruPreflight.current) return;
    const hasMineruWork = blocks => blocks?.some(block => block.status === 'ok' || block.bookmark || block.highlights?.length || block.notes?.length);
    if ((paper.sourceMode === 'mineru' && (hasMineruWork(paper.blocks) || paper.summary || paper.connectedTranslation)) || hasMineruWork(paper.mineruBlocks)) {
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
      const markdown = await api.extractMineru({ id: paper.id, executable: runtime.executable, backend: settings.mineruBackend });
      if (token.cancelled) return;
      const blocks = parsedMarkdownBlocks(markdown);
      if (!blocks.length) { setStatus('MinerU completed but found no readable blocks. The original PDF and existing Reader were kept.'); return; }
      resetReadingHistory();
      commitPaper(current => {
        const hasUserWork = current.summary || current.connectedTranslation || current.blocks.some(block => block.status === 'ok' || block.bookmark || block.highlights?.length || block.notes?.length);
        return { ...current, mineruMarkdown: markdown, mineruBlocks: blocks, pdfBlocks: current.pdfBlocks || current.blocks, blocks: hasUserWork ? current.blocks : blocks, extraction: hasUserWork ? current.extraction : 'MinerU', sourceMode: hasUserWork ? (current.sourceMode || 'pdf') : 'mineru' };
      });
      setStatus(`MinerU structure ready: ${blocks.length} blocks. You can switch Reader source without discarding either version.`);
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  function switchSourceMode(mode) {
    if (!paper || paper.sourceMode === mode || taskRef.current) return;
    resetReadingHistory();
    commitPaper(current => {
      const switched = mode === 'mineru'
        ? { ...current, pdfBlocks: current.blocks, blocks: current.mineruBlocks, extraction: 'MinerU', sourceMode: 'mineru' }
        : { ...current, mineruBlocks: current.blocks, blocks: current.pdfBlocks, extraction: 'PDF.js', sourceMode: 'pdf' };
      const restored = switchOutputSettings(switched, current.sourceSettings?.[mode] || settingsRef.current, settingsRef.current, { paragraphsOnly: true });
      return { ...restored, summary: restored.summary ? { ...restored.summary, stale: true } : null, connectedStale: Boolean(restored.connectedTranslation) };
    });
    setUndo([]); setSelection(null); setSearch('');
    setActiveBlock(1);
    setStatus(`Reader source changed to ${mode === 'mineru' ? 'MinerU' : 'PDF text'}. The other version remains saved.`);
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
    if (!paper) return;
    let token = null;
    try {
      const result = await api.exportBundle({ paper: { id: paper.id, name: paper.name, type: paper.type }, documents: markdownDocuments(paper) });
      if (!result) return;
      setModal('');
      let pageImages = 0;
      if (paper.type === 'pdf') {
        token = startTask('Exporting portable PDF page images…');
        const pdf = await openPdf(await api.readPdf(paper.id));
        try {
          const limit = Math.min(pdf.numPages, 120);
          for (let pageNumber = 1; pageNumber <= limit && !token.cancelled; pageNumber++) {
            setProgress({ done: pageNumber - 1, total: limit });
            const page = await pdf.getPage(pageNumber);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(1.5, 1400 / base.width) });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
            const image = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not render a PDF page image.')), 'image/png'));
            await api.exportBundlePage({ id: paper.id, folder: result.folder, pageNumber, bytes: new Uint8Array(await image.arrayBuffer()) });
            pageImages++;
            setProgress({ done: pageNumber, total: limit });
          }
        } finally { if (typeof pdf.destroy === 'function') await pdf.destroy(); }
      }
      setStatus(`Exported ${result.documents} Markdown files, ${result.assets} asset(s), ${pageImages} PDF page image(s)${token?.cancelled ? ' (page export stopped)' : ''}${result.originalPdf ? ', and original PDF' : ''} to ${result.folder}`);
    } catch (cause) { setError(`Bundle export incomplete: ${cause.message}`); }
    finally { if (token) endTask(token); setModal(''); }
  }
  async function clearSavedData() {
    if (busy) return;
    try {
      if (!await finishNoteEditing()) throw new Error('Retry the failed paper save before removing local data.');
      await settingsSaveChain.current;
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
      const updated = { ...saved, name: libraryEdit.name.trim(), tags: libraryEdit.tags.split(',').map(value => value.trim()).filter(Boolean) };
      if (paperRef.current?.id === updated.id) commitPaper(current => ({ ...current, name: updated.name, tags: updated.tags }));
      else setLibrary(await api.savePaper(updated));
      setModal('library'); setLibraryEdit(null);
    } catch (cause) { setError(cause.message); }
  }
  function captureSelection() {
    const selected = window.getSelection();
    const range = selected.rangeCount ? selected.getRangeAt(0) : null;
    if (!range) return;
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const element = start?.closest('[data-block-id]');
    const captured = domSelectionIn(element);
    if (!captured) return;
    const block = paperRef.current?.blocks.find(item => item.id === Number(element.dataset.blockId));
    const kind = element.dataset.kind || 'source';
    const source = anchorText(block, kind);
    const { text, rect } = captured;
    const offset = exactAnchorOffset(source, captured);
    const nextSelection = { id: block?.id ?? null, kind, text, offset, displayOffset: captured.offset, scope: 'reader', rect };
    if (selectionRef.current && selectionIdentity(selectionRef.current) !== selectionIdentity(nextSelection)) void finishNoteEditing();
    setSelection(nextSelection);
    const saved = findSelectionNote(paperRef.current, nextSelection);
    setSelectionResults({}); setNoteDraft(saved?.body || '');
  }
  function addHighlight(color) {
    if (!selection) return;
    if (isPdfScope(selection.scope)) {
      if (!validPdfSelection(selection) || selection.page !== pageNumber) { setError('Select exact text on the current PDF page before highlighting.'); return; }
      const saved = paper.pdfHighlights || [];
      const matching = saved.filter(item => highlightMatchesSelection(item, selection));
      if (matching.length === 1 && matching[0].color === color) { setStatus('This highlight already uses that color.'); return; }
      rememberUndo();
      const item = { ...(matching[0] || {}), id: matching[0]?.id || crypto.randomUUID(), scope: selection.scope, page: selection.page, offset: selection.offset, text: selection.text, color };
      commitPaper(current => ({ ...current, pdfHighlights: [...saved.filter(entry => !highlightMatchesSelection(entry, selection)), item] }));
      setStatus(`PDF highlight ${matching.length ? 'color updated' : 'saved'} in ${selection.scope === 'paperPdf' ? 'Paper' : 'Original'}.`);
      return;
    }
    if (['summarySource', 'summaryTarget', 'fullTranslation'].includes(selection.scope)) {
      if (!validViewAnchor(paper, selection)) { setError('This selection cannot be anchored exactly in the saved document.'); return; }
      const saved = paper.viewHighlights || [];
      const matching = saved.filter(item => highlightMatchesSelection(item, selection));
      if (matching.length === 1 && matching[0].color === color) { setStatus('This highlight already uses that color.'); return; }
      rememberUndo();
      const item = { ...(matching[0] || {}), id: matching[0]?.id || crypto.randomUUID(), scope: selection.scope, text: selection.text, offset: selection.offset, displayOffset: selection.displayOffset, color };
      commitPaper(current => ({ ...current, viewHighlights: [...saved.filter(entry => !highlightMatchesSelection(entry, selection)), item] }));
      setStatus(matching.length ? 'Highlight color updated.' : 'Highlight saved in the annotation list.');
      return;
    }
    const block = paper.blocks.find(item => item.id === selection.id);
    const key = selection.kind === 'translation' ? 'translationHighlights' : 'highlights';
    const source = anchorText(block, selection.kind);
    if (!['reader', 'paper'].includes(selection.scope) || !block || !Number.isInteger(selection.offset) || source?.slice(selection.offset, selection.offset + selection.text.length) !== selection.text) { setError('This exact selection cannot be anchored to one source block.'); return; }
    const highlights = block[key] || [];
    const matching = highlights.filter(item => highlightMatchesSelection(item, selection));
    if (matching.length === 1 && matching[0].color === color) { setStatus('This highlight already uses that color.'); return; }
    rememberUndo();
    const item = { ...(matching[0] || {}), id: matching[0]?.id || crypto.randomUUID(), scope: selection.scope, text: selection.text, offset: selection.offset, displayOffset: selection.displayOffset, color };
    updateBlock(block.id, { [key]: [...highlights.filter(entry => !highlightMatchesSelection(entry, selection)), item] });
    setStatus(matching.length ? 'Highlight color updated.' : 'Highlight saved.');
  }
  function removeSelectionHighlight() {
    if (!paper || !selection || !selectionHighlights(paper, selection).length) return;
    rememberUndo();
    if (isPdfScope(selection.scope)) commitPaper(current => ({ ...current, pdfHighlights: (current.pdfHighlights || []).filter(item => !highlightMatchesSelection(item, selection)) }));
    else if (['summarySource', 'summaryTarget', 'fullTranslation'].includes(selection.scope)) commitPaper(current => ({ ...current, viewHighlights: (current.viewHighlights || []).filter(item => !highlightMatchesSelection(item, selection)) }));
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
    if (!validNoteSelection(currentPaper, currentSelection) || isPdfScope(currentSelection.scope) && currentSelection.page !== pageNumber) {
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
  function addTerm() {
    if (!selection || !termDraft.trim()) return false;
    if (selection.text.length > 160 || termDraft.trim().length > 300) { setError('Use at most 160 characters for the term and 300 for its translation.'); return false; }
    const sourceLanguage = selection.kind === 'translation' ? settings.targetLanguage : settings.sourceLanguage;
    const targetLanguage = selection.kind === 'translation' ? settings.sourceLanguage : settings.targetLanguage;
    const matches = term => term.source.toLocaleLowerCase() === selection.text.toLocaleLowerCase() && term.sourceLanguage === sourceLanguage && term.targetLanguage === targetLanguage;
    if (glossary.length >= 500 && !glossary.some(matches)) { setError('The terminology list is full. Remove a term before adding another.'); return false; }
    setGlossary(current => [{ source: selection.text, target: termDraft.trim(), sourceLanguage, targetLanguage }, ...current.filter(term => !matches(term))]);
    setTermDraft(''); setStatus('Term saved for future translations.');
    return true;
  }
  function bookmark(id) { const block = paper.blocks.find(item => item.id === id); rememberUndo(); updateBlock(id, { bookmark: !block.bookmark }); }
  function navigate(id) {
    if (!paperRef.current?.blocks.some(block => block.id === id)) return;
    recordReadingJump(location => location.tab === 'Reader' && !location.search && location.block === id);
    searchOrigin.current = null; setSearch(''); setActiveBlock(id); setTab('Reader');
    commitPaper(current => ({ ...current, position: { ...current.position, block: id } }));
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
      && selectionRef.current?.offset === item.offset && selectionRef.current?.text === item.text);
    window.getSelection()?.removeAllRanges();
    setInspector(true); setSelection(null); setSearch(''); searchOrigin.current = null; setActiveBlock(blockId); setDisplayMode(mode); setTab(targetTab);
    setBlockNavigation({ ...item, scope, blockId, kind, recordType, requestId: crypto.randomUUID() });
    commitPaper(current => ({ ...current, position: { ...current.position, tab: targetTab, block: blockId, displayMode: mode } }));
  }
  function navigateView(item) {
    if (item.needsReview || !validViewAnchor(paperRef.current, item)) {
      if (!item.needsReview) commitPaper(current => ({ ...current,
        viewNotes: (current.viewNotes || []).map(note => note.id === item.id ? { ...note, needsReview: true } : note),
        viewHighlights: (current.viewHighlights || []).map(highlight => highlight.id === item.id ? { ...highlight, needsReview: true } : highlight)
      }));
      setError('The saved Markdown text no longer matches this view. The annotation was kept for review.');
      return;
    }
    const targetTab = item.scope === 'fullTranslation' ? 'Full Translation' : 'Summary';
    recordReadingJump(location => location.tab === targetTab && selectionRef.current?.scope === item.scope
      && selectionRef.current?.offset === item.offset && selectionRef.current?.text === item.text);
    setInspector(true);
    setTab(targetTab);
    setViewNavigation({ ...item, id: crypto.randomUUID() });
  }
  function navigatePdf(item) {
    if (item.needsReview) { setError('This saved PDF annotation needs review before it can be opened.'); return; }
    const scope = pdfAnnotationScope(item);
    const targetTab = scope === 'paperPdf' ? 'Paper' : 'Original';
    recordReadingJump(location => location.tab === targetTab && location.page === item.page && selectionRef.current?.scope === scope
      && selectionRef.current?.offset === item.offset && selectionRef.current?.text === item.text);
    setInspector(true); setTab(targetTab); setPageNumber(item.page);
    if (scope === 'paperPdf') setDisplayMode('source');
    setPdfNavigation({ ...item, scope, id: crypto.randomUUID() });
    commitPaper(current => ({ ...current, position: { ...current.position, tab: targetTab, page: item.page, ...(scope === 'paperPdf' ? { displayMode: 'source' } : {}) } }));
  }
  function pdfNavigationReady(anchor) {
    const scope = pdfAnnotationScope(pdfNavigation);
    setSelection({ ...anchor, id: null, kind: 'source', scope, rect: null });
    setSelectionResults({});
    setNoteDraft(findSelectionNote(paperRef.current, { ...anchor, scope })?.body || '');
    setPdfNavigation(null);
  }
  function pdfNavigationFailed() {
    const requested = pdfNavigation;
    if (requested) commitPaper(current => ({ ...current,
      pdfNotes: (current.pdfNotes || []).map(item => pdfAnnotationScope(item) === pdfAnnotationScope(requested) && item.page === requested.page && item.offset === requested.offset && item.text === requested.text ? { ...item, needsReview: true } : item),
      pdfHighlights: (current.pdfHighlights || []).map(item => pdfAnnotationScope(item) === pdfAnnotationScope(requested) && item.page === requested.page && item.offset === requested.offset && item.text === requested.text ? { ...item, needsReview: true } : item)
    }));
    setPdfNavigation(null);
    setError('The saved PDF text no longer matches this page. The annotation was kept for review.');
  }
  function modifyBlocks(transform) {
    if (taskRef.current) { setError('Finish or stop the current task before editing the source.'); return; }
    if (paper.sourceMode === 'mineru') { setError('MinerU controls this document structure. Edit an exported Markdown copy instead.'); return; }
    resetReadingHistory();
    rememberUndo();
    commitPaper(current => ({ ...current, blocks: transform(current.blocks).map((block, index) => ({ ...block, id: index + 1 })), summary: current.summary ? { ...current.summary, stale: true } : null, connectedStale: Boolean(current.connectedTranslation) }));
    setEdit(null); setSelection(null);
  }
  function saveEdit() { if (!edit?.text.trim()) return; modifyBlocks(blocks => blocks.map(block => block.id === edit.id ? editedBlock(block, edit.text) : block)); }
  function splitBlock(id) { const block = paper.blocks.find(item => item.id === id); const at = Math.max(block.text.lastIndexOf('. ', Math.floor(block.text.length / 2)), block.text.lastIndexOf('。', Math.floor(block.text.length / 2))); if (at < 10) { setError('No safe sentence boundary found. Edit this block manually.'); return; } modifyBlocks(blocks => blocks.flatMap(item => item.id === id ? splitBlockAt(item, at + 1) : [item])); }
  function reflowParagraph(id) {
    const block = paper.blocks.find(item => item.id === id);
    const pieces = reflowBlock(block);
    if (pieces.length === 1) { setStatus(`Block ${id} is already short enough or has no safe sentence boundary.`); return; }
    modifyBlocks(blocks => blocks.flatMap(item => item.id === id ? pieces : [item]));
    setStatus(`Reflowed block ${id} into ${pieces.length} complete-sentence blocks.`);
  }
  function captureViewSelection(event, scope, kind) {
    const host = scope === 'paper' ? event.currentTarget : event.currentTarget.querySelector('[data-markdown-host]');
    const captured = domSelectionIn(host);
    if (!captured) return;
    const { text, rect } = captured;
    const range = window.getSelection().getRangeAt(0);
    let id = null;
    let offset = null;
    let displayOffset = null;
    if (scope === 'paper') {
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
      const side = start?.closest('[data-paper-kind]');
      const element = side?.closest('[data-paper-block-id]');
      const block = paperRef.current?.blocks.find(item => item.id === Number(element?.dataset.paperBlockId));
      const within = domSelectionIn(side);
      if (block && within?.text === text) {
        id = block.id;
        offset = exactAnchorOffset(anchorText(block, kind), within);
        displayOffset = within.offset;
      }
    } else {
      const source = scope === 'summarySource' ? paperRef.current?.summary?.source : scope === 'summaryTarget' ? paperRef.current?.summary?.target : paperRef.current?.connectedTranslation;
      displayOffset = captured.offset;
      const matches = [];
      let searchAt = 0;
      while (source && searchAt < source.length) {
        const at = source.indexOf(text, searchAt);
        if (at < 0) break;
        matches.push(at); searchAt = at + text.length;
      }
      const ordinal = captured.context.slice(0, captured.offset).split(text).length - 1;
      offset = matches[ordinal] ?? null;
    }
    const nextSelection = { id, kind, text, offset, displayOffset, scope, rect, context: captured.context.slice(Math.max(0, captured.offset - 300), captured.offset + text.length + 300) };
    if (selectionRef.current && selectionIdentity(selectionRef.current) !== selectionIdentity(nextSelection)) void finishNoteEditing();
    const saved = findSelectionNote(paperRef.current, nextSelection);
    setSelection(nextSelection); setSelectionResults({}); setNoteDraft(saved?.body || '');
  }
  function mergeBlock(id) { if (id <= 1) return; modifyBlocks(blocks => blocks.filter(item => item.id !== id).map(item => item.id === id - 1 ? mergeBlocks(item, blocks.find(block => block.id === id)) : item)); }
  function mergeNextBlock(id) { if (id >= paper.blocks.length) return; modifyBlocks(blocks => blocks.filter(item => item.id !== id + 1).map(item => item.id === id ? mergeBlocks(item, blocks.find(block => block.id === id + 1)) : item)); }
  const outline = useMemo(() => paper?.blocks.filter(block => block.heading) || [], [paper]);
  const sections = useMemo(() => sectionRanges(paper?.blocks || []), [paper]);
  const referenceIDs = useMemo(() => referenceBlockIds(paper?.blocks || []), [paper]);
  const extractionIssues = useMemo(() => qualityIssues(paper?.blocks || [], referenceIDs), [paper, referenceIDs]);
  const filteredLibrary = library.filter(item => `${item.name} ${(item.tags || []).join(' ')}`.toLowerCase().includes(librarySearch.toLowerCase()));
  const visibleBlocks = paper?.blocks.filter(block => !search || `${block.text} ${block.translation}`.toLowerCase().includes(search.toLowerCase())) || [];
  const paragraphExplanation = cachedExplanation(paper, activeBlock, explanationLanguage, settings);
  const translatedCount = paper?.blocks.filter(block => block.status === 'ok' && !block.resource && !referenceIDs.has(block.id)).length || 0;
  const failedCount = paper?.blocks.filter(block => block.status === 'failed' && !block.resource && !referenceIDs.has(block.id)).length || 0;
  const translatableCount = paper?.blocks.filter(block => !block.resource && !referenceIDs.has(block.id)).length || 0;
  const activeSelectionHighlights = selectionHighlights(paper, selection);
  const activeHighlightColor = activeSelectionHighlights.length ? displayHighlightColor(activeSelectionHighlights[0].color) : '';
  const readingAppearance = { '--reader-font': `${settings?.fontSize || 17}px`, '--reader-line': settings?.lineHeight || 1.6, '--reader-width': `${settings?.readingWidth || 920}px` };
  const currentSection = sections.findLast(section => section.startId <= activeBlock);
  const currentSectionIds = translationRangeIds(paper?.blocks || [], currentSection?.ids || [], referenceIDs);
  const abstractConclusionIds = translationRangeIds(paper?.blocks || [], sections.filter(section => /abstract|conclusion|摘要|结论/i.test(section.title)).flatMap(section => section.ids), referenceIDs);
  const unfinishedTranslationIds = translationRangeIds(paper?.blocks || [], null, referenceIDs);
  const menuReady = ready && modal !== 'onboarding';
  const menuBusy = Boolean(busy || onboardingBusy);
  const canPrimaryTask = translatableCount > 0 && (tab === 'Summary' ? !paper.summary || paper.summary.stale : tab === 'Full Translation' ? !paper.connectedTranslation || paper.connectedStale : translatedCount < translatableCount);
  const canUndo = undo.length > 0 && (!menuBusy || undo.at(-1)?.type !== 'structure');
  useEffect(() => {
    api.updateMenuState({ ready: menuReady, hasPaper: Boolean(paper), busy: menuBusy, hasSelection: Boolean(selection), canUndo,
      canGoBack: readingHistoryState.back > 0, canGoForward: readingHistoryState.forward > 0,
      canPrimaryTask: Boolean(canPrimaryTask), canSummarize: translatableCount > 0, canFullTranslation: translatableCount > 0,
      canLookupSelection: Boolean(selection) && !menuBusy, canExport: Boolean(paper), checkingUpdates }).catch(cause => setError(cause.message));
  }, [menuReady, Boolean(paper), menuBusy, Boolean(selection), canUndo, readingHistoryState.back, readingHistoryState.forward, Boolean(canPrimaryTask), translatableCount > 0, checkingUpdates]);

  if (!ready || !settings) return <div className="loading">Opening PaperBridge…</div>;
  return <div data-display-mode={displayMode} style={readingAppearance} onDragOver={event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); }} onDrop={dropPdf} className={`app ${focus ? 'focus' : ''} ${!sidebar ? 'no-sidebar' : ''} ${!inspector ? 'no-inspector' : ''}`}>
    <aside className="sidebar" inert={Boolean(modal)}>
      <div className="brand"><img src="./brand.png" alt="" /><div><strong>PaperBridge</strong><small>Papers across languages</small><em>● Private by design</em></div></div>
      <div className="sidebar-scroll">
        <div className="side-group"><div className="side-label">SOURCE</div><button className="side-primary" onClick={openFile}><FilePlus2 size={16} /> Open PDF</button><button className="side-action" onClick={() => setModal('paste')}><FileText size={15} /> Paste Text</button><button className="side-action" onClick={loadPractice}><BookOpen size={15} /> Try a Practice Paper</button></div>
        <div className="side-group"><div className="side-label">LIBRARY <button title="Open library" onClick={() => setModal('library')}><Library size={15} /></button></div><input className="side-search" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Search papers or tags" />{filteredLibrary.slice(0, 12).map(item => <button key={item.id} className={`library-row ${paper?.id === item.id ? 'selected' : ''}`} onClick={() => loadPaper(item.id).catch(err => setError(err.message))}><span>{short(item.name, 29)}</span><small>{item.blockCount} blocks</small></button>)}</div>
        {paper && <><div className="side-group"><div className="side-label">DOCUMENT</div><strong className="side-title">{paper.name}</strong><div className="side-stat"><span>Blocks</span><b>{paper.blocks.length}</b></div><div className="side-stat"><span>Translated</span><b>{translatedCount}</b></div>{failedCount > 0 && <div className="side-stat failed-stat"><span>Failed</span><b>{failedCount}</b></div>}<div className="side-stat"><span>Parser</span><b>{paper.extraction}</b></div></div><div className="side-group"><div className="side-label">OUTLINE</div>{outline.slice(0, 60).map(block => <button className="outline-row" key={block.id} onClick={() => navigate(block.id)}><span>{short(block.text, 48)}</span><small>{block.page || block.id}</small></button>)}{!outline.length && <p className="side-hint">No headings detected.</p>}</div><div className="side-group"><div className="side-label">BOOKMARKS</div>{paper.blocks.filter(block => block.bookmark).map(block => <button className="outline-row" key={block.id} onClick={() => navigate(block.id)}>{short(block.text, 52)}</button>)}</div></>}
      </div>
      <div className="sidebar-footer"><button onClick={() => setModal('setup')}><Download size={16} /> Local AI setup</button><button onClick={() => setModal('settings')}><Settings2 size={16} /> Settings</button><button onClick={() => setModal('glossary')}><Languages size={16} /> Saved Terminology</button></div>
    </aside>
    <main className="workspace" inert={Boolean(modal)}>
      <header className="header"><div className="title-row"><button className="icon-button panel-toggle" title="Toggle sidebar" onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button><button className="icon-button" aria-label="Back to previous reading location" title="Back · Ctrl+[" disabled={!readingHistoryState.back} onClick={goBackInReading}><ChevronLeft size={18} /></button><button className="icon-button" aria-label="Forward in reading history" title="Forward · Ctrl+]" disabled={!readingHistoryState.forward} onClick={goForwardInReading}><ChevronRight size={18} /></button><div className="title-wrap"><h1>{paper?.name || 'PaperBridge'}</h1><p>{paper ? `${settings.sourceLanguage} → ${settings.targetLanguage} · ${paper.extraction} · ${paper.blocks.length} blocks` : 'A local space for academic reading'}</p></div><div className={`service ${ollamaError ? 'offline' : ''}`} title={ollamaError || 'Local Ollama is available'}>● {ollamaError ? 'Ollama unavailable' : 'Ollama Ready'}</div><button className="icon-button" title="Toggle inspector" onClick={() => { if (inspector) void finishNoteEditing(); setInspector(!inspector); }}>{inspector ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div>
      {paper && <div className="header-tools"><nav className="tabs">{[{ name: 'Paper', label: 'Paper' }, { name: 'Reader', label: 'Reader' }, { name: 'Original', label: 'Original' }, { name: 'Summary', label: 'Overview' }, { name: 'Full Translation', label: 'Full Translation' }].map(item => <button key={item.name} className={tab === item.name ? 'active' : ''} onClick={() => setTab(item.name)}>{item.label}</button>)}</nav><div className="toolbar-actions">{busy ? <button className="button danger" onClick={cancelTask}><Square size={14} /> Stop</button> : <button className="button coral" disabled={!translatableCount || translatedCount === translatableCount} onClick={() => translateBlocks(paper.blocks.map(block => block.id))}><Languages size={16} /> {translatedCount ? 'Resume Translation' : 'Translate Paper'}</button>}<button className="button ghost" onClick={() => setModal('more')}>More ···</button></div></div>}
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
      <div className="main-scroll" ref={mainScrollRef} onScroll={saveMainScroll}>
        {paper && status && <Notice>{status}</Notice>}
        {!paper && <div className="welcome"><img src="./brand.png" alt="" /><h1>Read across languages, locally.</h1><p>Keep the original paper nearby while translating, annotating, and exploring with local models.</p><div className="row"><button className="button blue" onClick={openFile}><FolderOpen size={17} /> Open PDF</button><button className="button outline" onClick={() => setModal('paste')}>Paste Text</button><button className="button outline" onClick={loadPractice}>Try a Practice Paper</button><button className="button outline" onClick={() => setModal('setup')}>Set up local AI</button></div><p className="welcome-note">Reading and notes work without AI. One-click setup detects and installs missing local tools.</p></div>}
        {paper && tab === 'Paper' && <div className="content-column">
          <div className="section-heading"><div><h2>Full document preview</h2><p>{paper.type === 'pdf' && displayMode === 'source' ? 'Exact native PDF rendering with selectable text and original page layout' : paper.sourceMode === 'mineru' && paper.mineruMarkdown ? 'MinerU Markdown with structure and formulas' : paper.type === 'pdf' ? 'Reflowed selectable PDF text · exact pages remain available in Original mode' : 'Selectable source text in a reflowable reading view'}</p></div><div className="row"><select aria-label="Paper display mode" value={displayMode} onChange={event => changeDisplayMode(event.target.value)}><option value="bilingual">Bilingual</option><option value="source">Original</option><option value="translation">Translation</option></select><button className="button outline" onClick={() => navigateToTab('Reader')}>Open Reader</button>{paper.type === 'pdf' && <button className="button outline" onClick={() => navigateToTab('Original')}>Original PDF</button>}</div></div>
          {paper.mineruBlocks && <div className="source-mode row"><span>Reader source: {paper.sourceMode === 'mineru' ? 'MinerU Markdown' : 'PDF text'}</span><button className="button outline" onClick={() => switchSourceMode(paper.sourceMode === 'mineru' ? 'pdf' : 'mineru')}>Switch to {paper.sourceMode === 'mineru' ? 'PDF text' : 'MinerU Markdown'}</button></div>}
          {paper.type === 'pdf' && displayMode === 'source' ? <PdfView
            paper={paper}
            pageNumber={pageNumber}
            highlights={(paper.pdfHighlights || []).filter(item => pdfAnnotationScope(item) === 'paperPdf')}
            navigation={pdfNavigation?.scope === 'paperPdf' ? pdfNavigation : null}
            onRendered={restoreMainScroll}
            onPage={number => { void finishNoteEditing(); restoringScroll.current = true; setPageNumber(number); setPdfNavigation(null); setSelection(null); commitPaper(current => ({ ...current, position: { ...current.position, page: number } })); }}
            onSelect={anchor => { const nextSelection = { ...anchor, id: null, kind: 'source', scope: 'paperPdf' }; if (selectionRef.current && selectionIdentity(selectionRef.current) !== selectionIdentity(nextSelection)) void finishNoteEditing(); setSelection(nextSelection); setSelectionResults({}); setNoteDraft(findSelectionNote(paperRef.current, nextSelection)?.body || ''); }}
            onNavigate={pdfNavigationReady}
            onNavigationFailure={pdfNavigationFailed}
            onOcr={runMineru}
            onSetup={() => setModal('setup')}
            onReader={() => { changeDisplayMode('bilingual'); }}
          /> : <>
            {paper.type === 'pdf' && !paper.blocks.length && <ScanNotice onParse={runMineru} onSetup={() => setModal('setup')} />}
            <PaperPreview paper={paper} displayMode={displayMode} onSelect={captureViewSelection} />
          </>}
        </div>}
        {paper && tab === 'Reader' && <div className="reader-layout"><div className="reader-top"><div><h2>{displayMode === 'bilingual' ? 'Bilingual Reader' : displayMode === 'source' ? 'Original Reader' : 'Translation Reader'}</h2><p>{translatedCount} of {translatableCount} blocks translated</p></div><div className="row"><select className="reader-mode-select" aria-label="Reading mode" value={displayMode} onChange={event => changeDisplayMode(event.target.value)}><option value="bilingual">Bilingual</option><option value="source">Original</option><option value="translation">Translation</option></select><input ref={searchRef} className="search" placeholder="Search paper  Ctrl+F" value={search} onChange={event => changeSearch(event.target.value)} /><button className="icon-button" title="Focus reading" onClick={toggleFocus}><Focus size={18} /></button></div></div><div className="reader-list" style={{ '--reader-font': `${settings.fontSize}px`, '--reader-line': settings.lineHeight, '--reader-width': `${settings.readingWidth}px` }} onMouseUp={captureSelection}>{visibleBlocks.map(block => <article id={`block-${block.id}`} key={block.id} className={`block ${block.heading ? 'heading-block' : ''} ${activeBlock === block.id ? 'current' : ''}`} data-heading-status={block.heading ? block.status : undefined} onClick={() => { setActiveBlock(block.id); if (paper.position?.block !== block.id) commitPaper(current => ({ ...current, position: { ...current.position, block: block.id } })); }}><div className="block-header"><span>{block.page ? `PAGE ${block.page} · ` : ''}BLOCK {block.id}</span><div className="row"><button className={`mini-action ${block.bookmark ? 'bookmarked' : ''}`} title={block.heading ? 'Bookmark heading' : 'Bookmark'} onClick={event => { event.stopPropagation(); bookmark(block.id); }}><Bookmark size={15} fill={block.bookmark ? 'currentColor' : 'none'} /></button><button className="mini-action" title={block.heading ? 'Edit or split heading' : 'Edit source'} disabled={paper.sourceMode === 'mineru'} onClick={event => { event.stopPropagation(); setEdit({ id: block.id, text: block.text }); }}><Pencil size={15} /></button>{(!block.heading || block.status !== 'ok' && displayMode !== 'source') && <button className="mini-action" title={block.heading ? block.status === 'failed' ? 'Retry heading' : 'Translate heading' : 'Translate or retry block'} onClick={event => { event.stopPropagation(); translateBlocks([block.id]); }}><Languages size={15} /></button>}<button className="mini-action" title={block.heading ? 'Explain heading' : 'Explain full paragraph'} disabled={block.resource} onClick={event => { event.stopPropagation(); setActiveBlock(block.id); explainBlock(block.id); }}><Sparkles size={15} /></button></div></div>{edit?.id === block.id ? <div className="edit-area"><textarea value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })} /><div className="row"><button className="button blue" onClick={saveEdit}>Save edit</button><button className="button ghost" onClick={() => setEdit(null)}>Cancel</button><button className="button ghost" onClick={() => splitBlock(block.id)}><Scissors size={15} /> Split</button><button className="button ghost" onClick={() => reflowParagraph(block.id)}>Reflow at full sentences</button><button className="button ghost" disabled={block.id === 1} onClick={() => mergeBlock(block.id)}><Merge size={15} /> Merge previous</button><button className="button ghost" disabled={block.id >= paper.blocks.length} onClick={() => mergeNextBlock(block.id)}><Merge size={15} /> Merge next</button></div></div> : <><div className="source-text" data-block-id={block.id} data-kind="source">{block.sourceMarkdown ? <Markdown highlights={blockAnnotationsFor(block.highlights, 'reader')}>{block.sourceMarkdown}</Markdown> : withHighlight(block.text, blockAnnotationsFor(block.highlights, 'reader'))}</div>{!block.resource && !referenceIDs.has(block.id) && <div className={`translation-text ${block.status === 'ok' ? 'done' : ''}`} data-block-id={block.id} data-kind="translation">{block.status === 'ok' ? (block.translationMarkdown ? <Markdown highlights={blockAnnotationsFor(block.translationHighlights, 'reader')}>{block.translationMarkdown}</Markdown> : withHighlight(block.translation, blockAnnotationsFor(block.translationHighlights, 'reader'))) : block.status === 'failed' ? <span className="failure"><AlertCircle size={15} /> {block.error || 'Translation failed'} <button onClick={() => translateBlocks([block.id])}>Retry</button></span> : <span className="pending">Translation pending · select the translate button to begin</span>}</div>}</>}{blockAnnotationsFor(block.notes, 'reader').length > 0 && <div className="block-notes">{blockAnnotationsFor(block.notes, 'reader').map(note => <p key={note.id}><MessageSquareText size={14} /> <b>{short(note.text, 70)}</b> {note.body}</p>)}</div>}</article>)}{!visibleBlocks.length && (paper.type === 'pdf' && !paper.blocks.length ? <ScanNotice onParse={runMineru} onSetup={() => setModal('setup')} /> : <Empty title="No matching blocks" body="Try another search term." />)}</div>{undo.length > 0 && <button className="undo-button" onClick={undoLastChange}><Undo2 size={16} /> Undo last change</button>}</div>}
        {paper && tab === 'Original' && <PdfView
          paper={paper}
          pageNumber={pageNumber}
          highlights={(paper.pdfHighlights || []).filter(item => pdfAnnotationScope(item) === 'pdf')}
          navigation={pdfNavigation?.scope !== 'paperPdf' ? pdfNavigation : null}
          onRendered={restoreMainScroll}
          onPage={number => { void finishNoteEditing(); restoringScroll.current = true; setPageNumber(number); setPdfNavigation(null); setSelection(null); commitPaper(current => ({ ...current, position: { ...current.position, page: number } })); }}
          onSelect={anchor => { const nextSelection = { ...anchor, id: null, kind: 'source', scope: 'pdf' }; if (selectionRef.current && selectionIdentity(selectionRef.current) !== selectionIdentity(nextSelection)) void finishNoteEditing(); setSelection(nextSelection); setSelectionResults({}); setNoteDraft(findSelectionNote(paperRef.current, nextSelection)?.body || ''); }}
          onNavigate={pdfNavigationReady}
          onNavigationFailure={pdfNavigationFailed}
          onOcr={runMineru}
          onSetup={() => setModal('setup')}
          onReader={() => navigateToTab('Reader')}
        />}
        {paper && tab === 'Summary' && <OverviewView paper={paper} busy={busy} summarize={summarize} navigate={navigate} onSelect={captureViewSelection} issues={extractionIssues} onOriginal={() => { changeDisplayMode('source'); navigateToTab('Paper'); }} onReader={() => navigateToTab('Reader')} translatedCount={paper.blocks.filter(block => block.status === 'ok').length} paragraphCount={paper.blocks.length} />}
        {paper && tab === 'Full Translation' && <div className="content-column"><div className="section-heading"><div><h2>Connected full translation</h2><p>A separate document-wide pass for consistent terminology</p></div><button className="button coral" disabled={!!busy || !paper.blocks.some(block => !block.heading && !block.resource)} onClick={() => fullTranslation(!!paper.connectedTranslation)}><Languages size={16} /> {paper.connectedTranslation ? 'Regenerate' : 'Translate full paper'}</button></div>{paper.connectedStale && <Notice tone="error">The source changed after this translation. Regenerate to update it.</Notice>}{paper.connectedTranslation ? <article className="document-preview" data-view-scope="fullTranslation" onMouseUp={event => captureViewSelection(event, 'fullTranslation', 'translation')}><Markdown highlights={(paper.viewHighlights || []).filter(item => item.scope === 'fullTranslation' && validViewAnchor(paper, item))}>{paper.connectedTranslation}</Markdown></article> : <Empty title={paper.blocks.length ? "No full translation yet" : "No readable text yet"} body={paper.blocks.length ? "This optional pass translates longer passages with context. The bilingual reader remains available separately." : "Use MinerU OCR from Paper or Original before translating this PDF."} />}</div>}
      </div>
    </main>
    <aside className={`inspector ${compactInspector ? 'inspector-drawer' : 'inspector-sidebar'}`} inert={Boolean(modal)}><div className="inspector-title"><div><h2>Research Inspector</h2><small>Selection, explanation, highlights, and notes</small></div><div className="row"><button className="icon-button" title="Undo last highlight or note change" disabled={!canUndo} onClick={undoLastChange}><Undo2 size={16} /></button><button className="icon-button" aria-label={compactInspector ? 'Close inspector drawer' : 'Hide inspector'} onClick={() => { void finishNoteEditing(); setInspector(false); }}>{compactInspector ? <X size={16} /> : <PanelRightClose size={16} />}</button></div></div><div className="inspector-body"><div className="inspector-primary">{selection ? <div className="inspector-scroll"><div className="inspector-section"><small className="selection-meta"><span>{isPdfScope(selection.scope) ? `${selection.scope === 'paperPdf' ? 'PAPER · EXACT PDF' : 'ORIGINAL PDF'} · PAGE ${selection.page}` : selection.id ? `SELECTED TEXT · BLOCK ${selection.id}` : `SELECTED TEXT · ${selection.scope}`}</span><span>{selection.kind === 'translation' ? 'TRANSLATION' : 'ORIGINAL'}</span></small><blockquote>{short(selection.text, 350)}</blockquote><div className="action-grid"><button disabled={!!busy} onClick={() => runSelection('translate')}><Languages size={16} /> Translate</button><button disabled={!!busy} onClick={() => runSelection('explain')}><Sparkles size={16} /> Explain</button></div>{busy && taskRef.current?.kind === 'selection' && <div className="selection-lookup-busy" role="status"><span>{busy.label}</span><button onClick={cancelTask}>Cancel</button></div>}{!busy && selectionLookup.error && <p className="selection-lookup-message error" role="alert">{selectionLookup.error}</p>}{!busy && !selectionLookup.error && selectionLookup.status && <p className="selection-lookup-message">{selectionLookup.status}</p>}</div><SelectionResults results={selectionResults} /><div className="inspector-section"><small>HIGHLIGHT</small><HighlightControls activeColor={activeHighlightColor} onAdd={addHighlight} onRemove={removeSelectionHighlight} /></div><div className="inspector-section"><small>NOTE · AUTO-SAVES</small><textarea key={noteSelectionIdentity(paper.id, selection)} aria-label="Note for selected passage" placeholder="What should you remember?" value={noteDraft} onChange={event => updateNote(event.target.value, noteSelectionIdentity(paper.id, selection))} onBlur={() => void finishNoteEditing()} /><button className="button blue" onClick={saveNote}>Save note</button></div><div className="inspector-section"><small>SAVED TERMINOLOGY</small><input placeholder="Approved translation" value={termDraft} onChange={event => setTermDraft(event.target.value)} /><button className="button outline" onClick={addTerm}>Save term</button></div></div> : <div className="inspector-scroll"><p className="inspector-help">Select text in Paper, Reader, Original PDF, Overview summaries, or Full Translation to translate, explain, highlight, annotate, or save a term.</p>{paper && <><div className="inspector-section"><small>THIS PAPER</small><p>{paper.blocks.filter(block => block.bookmark).length} bookmarks · {paper.blocks.reduce((count, block) => count + (block.notes?.length || 0), 0) + (paper.pdfNotes?.length || 0) + (paper.viewNotes?.length || 0)} notes</p></div><div className="inspector-section"><small>QUICK ACTIONS</small><button className="inspector-link" onClick={() => setModal('range')}>Choose translation range</button><button className="inspector-link" onClick={() => setModal('export')}>Export Markdown</button><button className="inspector-link" onClick={() => setModal('settings')}>Local AI settings</button></div></>}</div>}</div><div className="inspector-supporting">{paper && (!selection || selection.scope === 'reader') && <ParagraphExplanation paper={paper} activeBlock={activeBlock} language={explanationLanguage} setLanguage={changeExplanationLanguage} result={paragraphExplanation} onExplain={explainBlock} busy={busy} />}{paper && <SavedAnnotations paper={paper} navigateBlockAnnotation={navigateBlockAnnotation} navigateView={navigateView} navigatePdf={navigatePdf} removeNote={removeNote} removeHighlight={removeHighlight} removeViewNote={removeViewNote} removeViewHighlight={removeViewHighlight} removePdfNote={removePdfNote} removePdfHighlight={removePdfHighlight} />}</div></div></aside>
    {selection?.rect && !modal && !inspector && !focus && <QuickSelection selection={selection} results={selectionResults} busy={busy} lookup={selectionLookup} activeColor={activeHighlightColor} quickTermOpen={quickTermOpen} termDraft={termDraft} setTermDraft={setTermDraft} onTranslate={() => runSelection('translate')} onExplain={() => runSelection('explain')} onHighlight={addHighlight} onRemoveHighlight={removeSelectionHighlight} onOpenTerm={() => { setTermDraft(selectionResults.translate || ''); setQuickTermOpen(true); }} onSaveTerm={() => { if (addTerm()) setQuickTermOpen(false); }} onCancelTerm={() => { setQuickTermOpen(false); setTermDraft(''); }} onMore={() => { setInspector(true); setTimeout(() => document.querySelector('.inspector-section textarea')?.focus(), 0); }} onCancelTask={cancelTask} onClose={() => { void finishNoteEditing(); setSelection(null); setSelectionResults({}); }} />}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) dismissModal(); }}><div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-busy={modal === 'onboarding' && onboardingFinishing} tabIndex={-1} className={`modal ${modal === 'onboarding' ? 'onboarding-modal' : modal === 'settings' ? 'settings-modal' : ''}`}><div className="modal-head"><h2 id="modal-title">{({ paste: 'Paste text', settings: 'Settings', setup: 'Local AI setup', onboarding: 'Getting Started', glossary: 'Saved Terminology', library: 'Paper Library', libraryLabel: 'Edit Library Label', more: 'More tools', range: 'Translation range', export: 'Export Markdown', clearData: 'Remove Saved Data' })[modal]}</h2><button className="icon-button" aria-label="Close dialog" disabled={modal === 'onboarding' && (onboardingBusy || onboardingFinishing)} onClick={dismissModal}><X size={19} /></button></div>{modal === 'onboarding' && onboardingSaveError && <p className="onboarding-error" role="alert">{onboardingSaveError}</p>}<div className="modal-body" inert={modal === 'onboarding' && onboardingFinishing}>
      {modal === 'paste' && <><p>Paste a passage or complete paper. It stays on this computer.</p><textarea className="paste-area" value={paste} onChange={event => setPaste(event.target.value)} placeholder="Paste academic text here…" /><button className="button blue" onClick={() => importText(paste)}>Open text</button></>}
      {modal === 'onboarding' && <Onboarding settings={settings} onSettings={updateSettings} onFinish={finishOnboarding} onOpenSetup={() => finishOnboarding('setup')} progress={setupProgress} pullProgress={pullProgress} models={models} onModelsChanged={() => refreshModels(settingsRef.current)} onBusyChange={handleOnboardingBusy} />}
      {modal === 'setup' && <SetupPanel settings={settings} progress={setupProgress} onSettings={updateSettings} onInstalled={() => refreshModels(settings)} />}
      {modal === 'settings' && <SettingsPanel settings={settings} onSettings={updateSettings} languages={languages} busy={Boolean(busy)}
        onOnboarding={openOnboarding} onOpenSetup={() => setModal('setup')} onClearData={() => setModal('clearData')}
        modelTools={{ models, ollamaError, pulling, cancelling: cancellingPull, progress: pullProgress, message: modelDownloadMessage, error: modelDownloadError,
          name: pullModel, onName: setPullModel, onRefresh: () => refreshModels(settingsRef.current), onDownload: downloadModel, onCancel: cancelModelDownload,
          onUse: useRecommendedModel, onRecommendation: model => { setPullModel(model.id); downloadModel(model.id, model); } }}
        hardwareTools={{ hardware, mineruRuntime, runningModels, checking: checkingHardware, onCheck: checkHardware, error: hardwareError }}
        updates={{ version: appVersion, checking: checkingUpdates, status: updateStatus, onCheck: () => checkForUpdates(false) }} />}
      {modal === 'glossary' && <><p>Approved terms guide future translations in the same language direction.</p><input placeholder="Search saved terms" value={glossarySearch} onChange={event => setGlossarySearch(event.target.value)} />{[...glossary.entries()].filter(([, term]) => `${term.source} ${term.target}`.toLowerCase().includes(glossarySearch.toLowerCase())).map(([index, term]) => <div className="term-row" key={`${term.source}-${index}`}><span><b>{term.source}</b> → {term.target}<small>{term.sourceLanguage} → {term.targetLanguage}</small></span><button className="icon-button" aria-label={`Remove ${term.source}`} onClick={() => setGlossary(current => current.filter((_, at) => at !== index))}><Trash2 size={16} /></button></div>)}{!glossary.length && <p>No saved terms yet. Select a phrase in Reader to add one.</p>}</>}
      {modal === 'library' && <LibraryView items={filteredLibrary} query={librarySearch} setQuery={setLibrarySearch} loadPaper={loadPaper} setModal={setModal} setError={setError} setLibraryEdit={setLibraryEdit} />}
      {modal === 'libraryLabel' && libraryEdit && <><p>Only the library label changes; the original PDF stays unchanged.</p><label>Title<input value={libraryEdit.name} onChange={event => setLibraryEdit({ ...libraryEdit, name: event.target.value })} /></label><label>Tags, separated by commas<input value={libraryEdit.tags} onChange={event => setLibraryEdit({ ...libraryEdit, tags: event.target.value })} /></label><div className="row"><button className="button blue" disabled={!libraryEdit.name.trim()} onClick={saveLibraryLabel}>Save label</button><button className="button outline" onClick={() => setModal('library')}>Cancel</button></div></>}
      {modal === 'more' && <div className="menu-list"><button onClick={() => setModal('range')}><Languages size={17} /> Translation Range</button><button onClick={() => { setModal(''); runMineru(); }} disabled={paper?.type !== 'pdf'}><FileText size={17} /> Parse with MinerU</button><button onClick={reextractAsNew} disabled={paper?.type !== 'pdf' || !!busy}><FilePlus2 size={17} /> Re-extract PDF as New Copy</button><button onClick={() => setModal('export')}><Download size={17} /> Export Markdown</button><button onClick={() => { setModal(''); toggleFocus(); }}><Focus size={17} /> {focus ? 'Exit Focus Reading' : 'Focus Reading'}</button><button onClick={() => setModal('settings')}><Settings2 size={17} /> Settings</button></div>}
      {modal === 'range' && <div className="menu-list">
        <button disabled={!!busy || !abstractConclusionIds.length} onClick={() => { setModal(''); translateBlocks(abstractConclusionIds); }}>Abstract & Conclusion <small>{abstractConclusionIds.length} blocks</small></button>
        <button disabled={!!busy || !currentSectionIds.length} onClick={() => { setModal(''); translateBlocks(currentSectionIds); }}>Current section: {currentSection?.title || 'Opening material'} <small>{currentSectionIds.length} blocks</small></button>
        {translationQueueRef.current && <button onClick={() => { prioritizeSection(currentSectionIds); setModal(''); }}>Prioritize current section in queue</button>}
        {sections.map(section => { const ids = translationRangeIds(paper.blocks, section.ids, referenceIDs); return <button key={section.startId} disabled={!!busy || !ids.length} onClick={() => { setModal(''); translateBlocks(ids); }}>Choose section: {section.title}<small>{ids.length} unfinished blocks</small></button>; })}
        <button disabled={!!busy || !unfinishedTranslationIds.length} onClick={() => { setModal(''); translateBlocks(unfinishedTranslationIds); }}>All unfinished blocks <small>{unfinishedTranslationIds.length} blocks</small></button>
      </div>}

      {modal === 'clearData' && <><p>This removes saved papers, translations, bookmarks, notes, terminology, and settings. Original PDF copies remain in the local workspace.</p><div className="row"><button className="button danger" onClick={clearSavedData}>Remove saved data</button><button className="button outline" onClick={() => setModal('settings')}>Cancel</button></div></>}
      {modal === 'export' && <div className="menu-list"><button onClick={exportBundle}><Download size={17} /> Export portable Markdown bundle</button>{[['original', 'Original Markdown'], ['translated', 'Translated Markdown'], ['bilingual', 'Bilingual Markdown'], ['analysis', 'Summary, sources and notes'], ...(paper.connectedTranslation ? [['full', 'Full Translation Markdown']] : [])].map(([kind, label]) => <button key={kind} onClick={() => exportMarkdown(kind)}><Download size={17} /> {label}</button>)}</div>}
    </div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
