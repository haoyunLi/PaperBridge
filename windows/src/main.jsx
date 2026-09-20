import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookOpen, FilePlus2, FolderOpen, Search, Settings2, Languages, Bookmark, Highlighter, MessageSquareText, Download, X, PanelRightClose, PanelRightOpen, ArrowRightLeft, Play, Square, RefreshCw, FileText, Library, ChevronLeft, ChevronRight, List, Sparkles, Pencil, Trash2, Undo2, Merge, Scissors, Focus, PanelLeftClose, PanelLeftOpen, Check, AlertCircle } from 'lucide-react';
import { openPdf, extractPdf } from './pdf.mjs';
import { blocksFromText, readingMap, chunkText, isHeading } from './text.mjs';
import { translationSystem, translationPrompt, explainPrompt, summaryPrompt, mergeSummaryPrompt, summaryQuotePrompt, protectMarkdown, restoreMarkdown, markdownTranslationPrompt } from './prompts.mjs';
import { referenceBlockIds, sectionRanges, qualityIssues, parseSummaryClaims, summarySourceCandidates, claimsMarkdown, revalidateSummaryClaims, splitBlockAt, reflowBlock, mergeBlocks, editedBlock } from './paper.mjs';
import SetupPanel from './SetupPanel.jsx';
import 'katex/dist/katex.min.css';
import './style.css';
import './hardware.css';
import './parity.css';

const api = window.paperBridge;
const languages = ['English', 'Simplified Chinese', 'Traditional Chinese', 'Japanese', 'Korean', 'French', 'German', 'Spanish', 'Italian', 'Portuguese', 'Russian'];
const sample = ['Abstract', 'This is a fictional practice document, not a published study. Use it to explore source-linked reading, translation, highlights, and notes without importing a personal paper.', '1 Introduction', 'Reading a paper across languages involves more than translating its sentences. Readers need to connect a claim to the method and evidence that support it.', '2 Methods', 'Start with the reading map, then open the linked source passage. Translate one paragraph when needed, or translate the whole document with a local Ollama model.', '3 Results', 'Selecting a phrase opens tools for translation, explanation, highlighting, and notes. This practice document contains no measured results or claims about model accuracy.', '4 Limitations', 'A summary is a reading aid, not a substitute for evidence. PDF text extraction and local models can make mistakes; compare uncertain passages with the Original PDF when one is available.', '5 Conclusion', 'Keep useful passages in bookmarks, retain your notes, and export the material you want to revisit. This sample requires no model until you choose an AI action.'];
const markdownPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function safeMarkdownUrl(url, key) { return key === 'src' && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(url) ? url : defaultUrlTransform(url); }
function Markdown({ children }) { return <ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={rehypePlugins} urlTransform={safeMarkdownUrl}>{children || ''}</ReactMarkdown>; }
function short(text, count = 92) { return text?.length > count ? `${text.slice(0, count)}…` : text; }
function viewText(paper, scope) {
  return scope === 'summarySource' ? paper.summary?.source || '' : scope === 'summaryTarget' ? paper.summary?.target || '' : scope === 'fullTranslation' ? paper.connectedTranslation || '' : '';
}
function validViewAnchor(paper, item) { return Number.isInteger(item.offset) && viewText(paper, item.scope).slice(item.offset, item.offset + item.text.length) === item.text; }
function parsedMarkdownBlocks(markdown) {
  return markdown.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map((part, index) => {
    const resource = /^(?:!\[[^\]]*\]\([^)]+\)|\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\]|```[\s\S]*```|<table[\s\S]*<\/table>)$/i.test(part) || /^\|.+\|\n\|[-: |]+\|/.test(part);
    return { id: index + 1, text: part.replace(/!\[[^\]]*\]\([^)]+\)/g, '[Figure]').replace(/\$[^$]+\$/g, '[Formula]').replace(/[#*_`]/g, '').trim(), sourceMarkdown: part, page: null, heading: /^#{1,6}\s/.test(part), resource, translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] };
  });
}
function markdownDocuments(paper) {
  const original = paper.blocks.map(block => block.sourceMarkdown || block.text).join('\n\n');
  const translated = paper.blocks.map(block => block.translationMarkdown || block.translation || (block.resource || block.heading ? block.sourceMarkdown || block.text : `[Untranslated block ${block.id}]`)).join('\n\n');
  const bilingual = paper.blocks.map(block => block.resource || block.heading ? block.sourceMarkdown || block.text : `### ${block.id}\n\n${block.sourceMarkdown || block.text}\n\n${block.translationMarkdown || block.translation || '*Not translated*'}`).join('\n\n');
  const evidence = (revalidateSummaryClaims(paper.summary?.claims, paper.blocks) || []).map((claim, index) => `### Claim ${index + 1}: ${claim.text}\n\n${claim.sources?.length ? claim.sources.map(source => `- Block ${source.paragraphID}: “${source.quote}”`).join('\n') : '- No exact source quotation validated.'}`).join('\n\n');
  const notes = [...paper.blocks.flatMap(block => (block.notes || []).map(note => `- Block ${block.id}: ${note.text} — ${note.body}`)), ...(paper.viewNotes || []).map(note => `- ${note.scope}${validViewAnchor(paper, note) ? '' : ' (source changed, review needed)'}: ${note.text} — ${note.body}`)].join('\n');
  const documents = [
    { kind: 'original', name: 'Original', content: original },
    { kind: 'translated', name: 'Translated', content: translated },
    { kind: 'bilingual', name: 'Bilingual', content: bilingual },
    { kind: 'analysis', name: 'Analysis', content: `# ${paper.name}\n\n## Source summary\n\n${paper.summary?.source || ''}\n\n## Target summary\n\n${paper.summary?.target || ''}\n\n## Checked sources\n\n${evidence || 'No exact source quotations validated.'}\n\n## Notes\n\n${notes}` }
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

function PdfView({ paper, pageNumber, onPage, onSelect, onRendered }) {
  const canvas = useRef(null);
  const layer = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState('');
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
      if (layer.current) { layer.current.innerHTML = ''; layer.current.style.width = `${viewport.width}px`; layer.current.style.height = `${viewport.height}px`; }
      task = page.render({ canvasContext: surface.getContext('2d'), canvas: surface, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await task.promise;
      if (cancelled || !layer.current) return;
      onRendered?.();
      try {
        const pdfjs = await import('pdfjs-dist');
        const textLayer = new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: layer.current, viewport });
        await textLayer.render();
      } catch { /* canvas remains a faithful page preview */ }
    })().catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber]);
  if (paper?.type !== 'pdf') return <Empty title="No original PDF" body="This document was created from pasted text." />;
  return <div className="pdf-panel"><div className="pdf-toolbar"><span>Exact original PDF · page {pageNumber} of {pdf?.numPages || '…'}</span><div className="row"><button className="icon-button" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => onPage(pageNumber - 1)}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="Next page" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => onPage(pageNumber + 1)}><ChevronRight size={17} /></button></div></div>{error ? <Notice tone="error">{error}</Notice> : <div className="pdf-scroll" onMouseUp={event => { if (event.target.closest('.textLayer')) onSelect?.(window.getSelection()?.toString().trim()); }}><div className="pdf-sheet"><canvas ref={canvas} /><div ref={layer} className="textLayer" /></div></div>}</div>;
}
function Empty({ title, body, children }) { return <div className="empty"><BookOpen size={36} strokeWidth={1.5} /><h2>{title}</h2><p>{body}</p>{children}</div>; }
function Notice({ children, tone = 'info', onClose }) { return <div className={`notice ${tone}`}><span>{children}</span>{onClose && <button className="icon-button" aria-label="Dismiss" onClick={onClose}><X size={15} /></button>}</div>; }

function SummaryView({ paper, busy, summarize, navigate, onSelect }) {
  const claims = revalidateSummaryClaims(paper.summary?.claims, paper.blocks);
  return <div className="content-column">
    <div className="section-heading"><div><h2>Paper summary</h2><p>Generated locally · verify each claim against the original</p></div><button className="button blue" disabled={!!busy} onClick={summarize}><Sparkles size={16} /> {paper.summary ? 'Regenerate' : 'Generate summary'}</button></div>
    {paper.summary ? <>
      {paper.summary.stale && <Notice tone="error">The source text changed after this summary was generated. Regenerate before relying on it.</Notice>}
      <article className="summary-card" onMouseUp={event => onSelect(event, 'summarySource', 'source')}><small>{paper.summary.sourceLanguage}</small><Markdown>{paper.summary.source}</Markdown></article>
      <article className="summary-card translated" onMouseUp={event => onSelect(event, 'summaryTarget', 'translation')}><small>{paper.summary.targetLanguage}</small><Markdown>{paper.summary.target}</Markdown></article>
      <div className="source-links"><h3>Check the Sources</h3>
        {claims ? claims.map((claim, index) => <div className="evidence-claim" key={index}>
          <strong>Claim {index + 1}: {claim.sources.length ? `${claim.sources.length} exact source passage(s)` : 'No source link validated'}</strong>
          <p>{claim.text}</p>
          {claim.sources.length ? claim.sources.map((source, at) => <div key={`${source.paragraphID}-${at}`}><blockquote>{source.quote}</blockquote><button onClick={() => navigate(source.paragraphID)}>Read original block {source.paragraphID} →</button></div>) : <small>Check the original paper independently before treating this claim as evidence.</small>}
        </div>) : <p>This saved summary predates exact source links. Its claims have not been validated.</p>}
      </div>
    </> : <Empty title="No summary yet" body="Generate a source and target language summary using your local model. Exact source quotations are linked only after validation." />}
  </div>;
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

function SavedAnnotations({ paper, navigate, navigateView, removeNote, removeHighlight, removeViewNote, removeViewHighlight }) {
  const notes = paper.blocks.flatMap(block => (block.notes || []).map(note => ({ block, note })));
  const highlights = paper.blocks.flatMap(block => [
    ...(block.highlights || []).map(highlight => ({ block, highlight, kind: 'source' })),
    ...(block.translationHighlights || []).map(highlight => ({ block, highlight, kind: 'translation' }))
  ]);
  const viewNotes = paper.viewNotes || [];
  const viewHighlights = paper.viewHighlights || [];
  if (!notes.length && !highlights.length && !viewNotes.length && !viewHighlights.length) return null;
  return <div className="inspector-section saved-annotations"><small>SAVED ANNOTATIONS · {notes.length + highlights.length + viewNotes.length + viewHighlights.length}</small>
    {notes.map(({ block, note }) => <div className="annotation-row" key={note.id}><button onClick={() => navigate(block.id)}><b>Block {block.id}{note.needsReview ? ' · source changed, note kept' : ''}</b><span>{short(note.text, 90)}</span><small>{short(note.body, 110)}</small></button><button className="icon-button" aria-label={`Delete note ${note.id}`} onClick={() => removeNote(block.id, note.id)}><Trash2 size={14} /></button></div>)}
    {highlights.map(({ block, highlight, kind }, index) => <div className="annotation-row" key={`${block.id}-${highlight.offset}-${index}`}><button onClick={() => navigate(block.id)}><b>Block {block.id} · {kind} · {highlight.color} highlight</b><span>{short(highlight.text, 90)}</span></button><button className="icon-button" aria-label={`Remove highlight ${block.id} ${index}`} onClick={() => removeHighlight(block.id, highlight, kind)}><Trash2 size={14} /></button></div>)}
    {viewNotes.map(note => <div className="annotation-row" key={note.id}><button onClick={() => navigateView(note.scope)}><b>{note.scope}{validViewAnchor(paper, note) ? '' : ' · source changed, review needed'}</b><span>{short(note.text, 90)}</span><small>{short(note.body, 110)}</small></button><button className="icon-button" aria-label={`Delete view note ${note.id}`} onClick={() => removeViewNote(note.id)}><Trash2 size={14} /></button></div>)}
    {viewHighlights.map(highlight => <div className="annotation-row" key={highlight.id}><button onClick={() => navigateView(highlight.scope)}><b>{highlight.scope} · {highlight.color}{validViewAnchor(paper, highlight) ? '' : ' · source changed, review needed'}</b><span>{short(highlight.text, 90)}</span></button><button className="icon-button" aria-label={`Remove view highlight ${highlight.id}`} onClick={() => removeViewHighlight(highlight.id)}><Trash2 size={14} /></button></div>)}
  </div>;
}

function ParagraphExplanation({ paper, activeBlock, language, setLanguage, result, onExplain, busy }) {
  const block = paper.blocks.find(item => item.id === activeBlock);
  if (!block || block.heading || block.resource) return null;
  return <div className="inspector-section paragraph-explanation"><small>FULL PARAGRAPH EXPLANATION · BLOCK {block.id}</small><select aria-label="Explanation language" value={language} onChange={event => setLanguage(event.target.value)}>{languages.map(value => <option key={value}>{value}</option>)}</select><button className="inspector-link" disabled={!!busy} onClick={() => onExplain(block.id)}>Explain full paragraph</button>{result?.id === block.id && <p>{result.output}</p>}</div>;
}

function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(null);
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
  const [paste, setPaste] = useState('');
  const [models, setModels] = useState([]);
  const [hardware, setHardware] = useState(null);
  const [mineruRuntime, setMineruRuntime] = useState(null);
  const [runningModels, setRunningModels] = useState([]);
  const [ollamaError, setOllamaError] = useState('');
  const [status, setStatus] = useState('Open a PDF or try the practice paper.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(null);
  const [search, setSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryEdit, setLibraryEdit] = useState(null);
  const [glossarySearch, setGlossarySearch] = useState('');
  const [selection, setSelection] = useState(null);
  const [selectionResult, setSelectionResult] = useState(null);
  const [explanationLanguage, setExplanationLanguage] = useState('English');
  const [paragraphExplanation, setParagraphExplanation] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [termDraft, setTermDraft] = useState('');
  const [inspector, setInspector] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const [focus, setFocus] = useState(false);
  const focusRestore = useRef(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [activeBlock, setActiveBlock] = useState(1);
  const [edit, setEdit] = useState(null);
  const [undo, setUndo] = useState([]);
  const [pullModel, setPullModel] = useState('');
  const [pullProgress, setPullProgress] = useState(null);
  const [setupProgress, setSetupProgress] = useState(null);
  const searchRef = useRef(null);
  const taskRef = useRef({ cancelled: false, ids: new Set() });
  const lookupCache = useRef(new Map());
  const translationQueueRef = useRef(null);
  const saveChain = useRef(Promise.resolve());
  const fileInputRef = useRef(null);
  const mainScrollRef = useRef(null);
  const scrollSaveTimer = useRef(null);
  const restoringScroll = useRef(false);
  const searchOrigin = useRef(null);

  const commitPaper = updater => {
    const current = paperRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    paperRef.current = next; setPaper(next);
    if (next) saveChain.current = saveChain.current.catch(() => {}).then(() => api.savePaper(next)).then(setLibrary).catch(err => setError(`Could not save paper: ${err.message}`));
    return next;
  };
  const loadPaper = async item => {
    const loaded = typeof item === 'string' ? await api.loadPaper(item) : item;
    if (!loaded) throw new Error('Paper could not be loaded.');
    paperRef.current = loaded; setPaper(loaded); setUndo([]); setTab(loaded.position?.tab || 'Paper'); setDisplayMode(loaded.position?.displayMode || 'bilingual'); setSelection(null); setSearch(''); setActiveBlock(loaded.position?.block || 1); setPageNumber(loaded.position?.page || 1); setStatus(`Opened ${loaded.name}.`);
  };
  const updateBlock = (id, change) => commitPaper(current => ({ ...current, blocks: current.blocks.map(block => block.id === id ? { ...block, ...change } : block) }));
  const updateSettings = change => setSettings(previous => ({ ...previous, ...change }));
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
  const rememberUndo = () => { const snapshot = paperRef.current; setUndo(previous => [...previous, snapshot].slice(-20)); };
  const restoreMainScroll = () => {
    restoringScroll.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const key = tab === 'Original' ? `Original:${pageNumber}` : tab;
      const saved = paperRef.current?.position?.scrollByTab?.[key];
      if (mainScrollRef.current) mainScrollRef.current.scrollTop = Number(saved || 0);
      if (saved == null && tab === 'Reader') document.getElementById(`block-${activeBlock}`)?.scrollIntoView({ block: 'start' });
      restoringScroll.current = false;
    }));
  };
  const saveMainScroll = () => {
    if (restoringScroll.current || !paperRef.current) return;
    clearTimeout(scrollSaveTimer.current);
    const id = paperRef.current.id;
    const key = tab === 'Original' ? `Original:${pageNumber}` : tab;
    const offset = mainScrollRef.current?.scrollTop || 0;
    scrollSaveTimer.current = setTimeout(() => {
      if (paperRef.current?.id !== id) return;
      commitPaper(current => ({ ...current, position: { ...current.position, scrollByTab: { ...current.position?.scrollByTab, [key]: offset } } }));
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
    try { const values = await api.listModels(config.ollamaBaseURL); setModels(values); setOllamaError(''); return values; }
    catch (err) { setModels([]); setOllamaError(err.message); return []; }
  };
  useEffect(() => {
    api.bootstrap().then(data => { setSettings(data.settings); setAppVersion(data.version); setGlossary(data.glossary); setLibrary(data.library); setReady(true); refreshModels(data.settings); api.graphicsStatus().then(setHardware).catch(() => {}); api.mineruRuntime(data.settings.mineruExecutable).then(setMineruRuntime).catch(() => {}); if (data.library.length) loadPaper(data.library[0].id).catch(err => setError(err.message)); }).catch(err => setError(err.message));
    const off = api.onProgress(data => { if (data.kind === 'setup') setSetupProgress(data); else if (data.kind === 'model') setPullProgress(data); else setStatus(data.status || 'MinerU is processing the PDF…'); });
    return off;
  }, []);
  useEffect(() => { if (ready && settings) api.saveSettings(settings).catch(err => setError(err.message)); }, [settings, ready]);
  useEffect(() => {
    if (!ready || settings?.autoCheckUpdates === false) return;
    checkForUpdates(true);
    const timer = setInterval(() => checkForUpdates(true), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [ready, settings?.autoCheckUpdates]);
  useEffect(() => { if (ready) api.saveGlossary(glossary).catch(err => setError(err.message)); }, [glossary, ready]);
  useEffect(() => { if (paperRef.current && paperRef.current.position?.tab !== tab) commitPaper(current => ({ ...current, position: { ...current.position, tab } })); }, [tab]);
  useEffect(() => { setSelection(null); setSelectionResult(null); }, [tab, paper?.id]);
  useEffect(() => {
    const key = event => {
      if (event.ctrlKey && event.key.toLowerCase() === 'o') { event.preventDefault(); openFile(); }
      if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setTab('Reader'); setTimeout(() => searchRef.current?.focus(), 0); }
      if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); setModal('library'); }
      if (event.key === 'Escape') { setModal(''); setSelection(null); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (paper) restoreMainScroll(); }, [tab, paper?.id]);
  useEffect(() => () => clearTimeout(scrollSaveTimer.current), []);

  async function openFile() {
    try {
      setBusy({ label: 'Opening PDF…' }); setError('');
      const imported = await api.importPdf();
      if (!imported) return;
      await ingestPdf(imported);
    } catch (err) { setError(err.message); } finally { setBusy(null); setProgress(null); }
  }
  async function dropPdf(event) {
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    if (files.length !== 1 || !/\.pdf$/i.test(files[0].name)) { setError('Drop one PDF file at a time.'); return; }
    try {
      setBusy({ label: 'Opening dropped PDF…' }); setError('');
      const imported = await api.importPdfBytes({ name: files[0].name, bytes: new Uint8Array(await files[0].arrayBuffer()) });
      await ingestPdf(imported);
    } catch (err) { setError(err.message); } finally { setBusy(null); setProgress(null); }
  }
  async function ingestPdf(imported) {
      if (imported.existing) { await loadPaper(imported.existing); return; }
      const pdf = await openPdf(imported.bytes);
      const mode = settings.pdfExtractionMode || 'mineruPreferred';
      let mineruMarkdown = '';
      let warning = '';
      if (mode !== 'pdfOnly') {
        const mineru = await api.mineruStatus(settings.mineruExecutable);
        if (mineru.compatible) {
          setBusy({ label: 'MinerU is reconstructing the paper…' });
          try { mineruMarkdown = await api.extractMineru({ id: imported.id, executable: mineru.executable, backend: settings.mineruBackend }); }
          catch (cause) { if (mode === 'mineruOnly') throw cause; warning = `MinerU failed: ${cause.message}. Using the selectable PDF text layer.`; }
        } else if (mode === 'mineruOnly') throw new Error('MinerU-only mode requires a working MinerU 3.x installation. Open Local AI setup.');
      }
      setBusy({ label: 'Reading PDF text layer…' });
      const pdfBlocks = await extractPdf(pdf, (done, total) => setProgress({ done, total }));
      const blocks = mineruMarkdown ? parsedMarkdownBlocks(mineruMarkdown) : pdfBlocks;
      const document = { id: imported.id, name: imported.name, type: 'pdf', createdAt: new Date().toISOString(), blocks, pdfBlocks, mineruBlocks: mineruMarkdown ? blocks : null, mineruMarkdown, sourceMode: mineruMarkdown ? 'mineru' : 'pdf', tags: [], summary: null, connectedTranslation: '', position: { block: 1, page: 1, tab: 'Paper', displayMode: 'bilingual' }, extraction: mineruMarkdown ? 'MinerU' : 'PDF.js' };
      setUndo([]); commitPaper(document); setTab('Paper'); setDisplayMode('bilingual');
      setStatus(warning || (blocks.length ? `Extracted ${blocks.length} blocks from ${pdf.numPages} pages. Compare uncertain passages with Original PDF.` : 'No selectable text found. The exact original PDF is available; use MinerU for OCR.'));
  }
  async function importText(text, name = 'Pasted Text') {
    if (!text.trim()) return;
    const id = await sha256(text.trim());
    const existing = await api.loadPaper(id);
    if (existing) await loadPaper(existing);
    else { setUndo([]); commitPaper({ id, name, type: 'text', createdAt: new Date().toISOString(), blocks: blocksFromText(text), tags: [], summary: null, connectedTranslation: '', position: { block: 1, page: 1, tab: 'Paper' }, extraction: 'Pasted text' }); setTab('Paper'); }
    setModal(''); setPaste('');
  }
  function loadPractice() {
    if (paperRef.current) { setStatus('The practice paper is available from the empty workspace. Your open paper remains unchanged.'); return; }
    importText(sample.join('\n\n'), 'Welcome to PaperBridge (practice sample)').catch(cause => setError(cause.message));
  }
  function startTask(label) { const token = { cancelled: false, ids: new Set() }; taskRef.current = token; setBusy({ label }); setProgress(null); setError(''); return token; }
  function endTask(token) { if (taskRef.current === token) { setBusy(null); setProgress(null); } }
  async function generate(model, prompt, system, token, format) {
    const requestId = crypto.randomUUID(); token.ids.add(requestId);
    try { const answer = await api.generate({ baseURL: settings.ollamaBaseURL, model, prompt, system, requestId, format }); if (token.cancelled) throw new Error('Cancelled'); return answer; }
    finally { token.ids.delete(requestId); }
  }
  function cancelTask() { taskRef.current.cancelled = true; for (const id of taskRef.current.ids) api.cancel(id); api.cancelMineru(); setBusy(null); setStatus('Task cancelled. Completed work was saved.'); }
  function matchingTerms(text, from = settings.sourceLanguage, to = settings.targetLanguage) { return glossary.filter(term => term.sourceLanguage === from && term.targetLanguage === to && text.toLowerCase().includes(term.source.toLowerCase())).slice(0, 24); }
  async function translateBlocks(ids) {
    if (!paperRef.current || busy) return;
    const token = startTask('Translating paragraphs…');
    const references = referenceBlockIds(paperRef.current.blocks);
    const queue = paperRef.current.blocks.filter(block => ids.includes(block.id) && block.status !== 'ok' && !block.heading && !block.resource && !references.has(block.id));
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
      }
      if (!token.cancelled) setStatus(`Translation pass finished. ${paperRef.current.blocks.filter(block => block.status === 'ok').length} blocks saved.`);
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
    if (!selection || busy) return;
    const block = paperRef.current.blocks.find(item => item.id === selection.id);
    const model = settings.quickLookupModel || (kind === 'translate' ? settings.translationModel : settings.explainModel);
    const from = selection.kind === 'translation' ? settings.targetLanguage : settings.sourceLanguage;
    const to = selection.kind === 'translation' ? settings.sourceLanguage : settings.targetLanguage;
    const cacheKey = JSON.stringify([paperRef.current.id, kind, selection.text, block?.text || '', from, to, model]);
    if (lookupCache.current.has(cacheKey)) { setSelectionResult({ kind, output: lookupCache.current.get(cacheKey) }); return; }
    const token = startTask(kind === 'translate' ? 'Translating selection…' : 'Explaining selection…');
    try {
      const output = kind === 'translate'
         ? await generate(model, translationPrompt(selection.text, from, to, matchingTerms(selection.text, from, to)), translationSystem(to), token)
         : await generate(model, explainPrompt(selection.text, block?.text || '', settings.targetLanguage), 'You are a patient academic explainer. Explain accurately and simply.', token);
      if (!token.cancelled) { lookupCache.current.set(cacheKey, output); setSelectionResult({ kind, output }); }
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function reextractAsNew() {
    if (paper?.type !== 'pdf' || busy) return;
    setModal(''); setBusy({ label: 'Creating a new extraction…' }); setError('');
    try { await ingestPdf(await api.copyPdfAsNew({ id: paper.id, name: paper.name })); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(null); setProgress(null); }
  }
  async function explainBlock(id) {
    const block = paperRef.current?.blocks.find(item => item.id === id);
    if (!block || busy) return;
    const token = startTask(`Explaining block ${id}…`);
    try {
      const output = await generate(settings.explainModel, explainPrompt(block.text, block.text, explanationLanguage), 'Explain this whole academic paragraph accurately and simply.', token);
      if (!token.cancelled) { setParagraphExplanation({ id, language: explanationLanguage, output }); setInspector(true); }
    } catch (cause) { if (!token.cancelled) setError(cause.message); } finally { endTask(token); }
  }
  async function summarize() {
    if (!paperRef.current || busy) return;
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
    if (!paperRef.current || busy) return;
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
      }
      setStatus(`Connected full-paper translation saved. ${outputs.filter(item => item.status === 'failed').length} block(s) retained in the original language.`);
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function runMineru() {
    if (!paper || paper.type !== 'pdf' || busy) return;
    const hasMineruWork = blocks => blocks?.some(block => block.status === 'ok' || block.bookmark || block.highlights?.length || block.notes?.length);
    if ((paper.sourceMode === 'mineru' && hasMineruWork(paper.blocks)) || hasMineruWork(paper.mineruBlocks)) {
      setError('This MinerU reader already contains saved work. Export it before parsing the PDF again.');
      return;
    }
    const token = startTask('MinerU is extracting structure…');
    try {
      const markdown = await api.extractMineru({ id: paper.id, executable: settings.mineruExecutable, backend: settings.mineruBackend });
      if (token.cancelled) return;
      const blocks = parsedMarkdownBlocks(markdown);
      commitPaper(current => {
        const hasUserWork = current.blocks.some(block => block.status === 'ok' || block.bookmark || block.highlights?.length || block.notes?.length);
        return { ...current, mineruMarkdown: markdown, mineruBlocks: blocks, pdfBlocks: current.pdfBlocks || current.blocks, blocks: hasUserWork ? current.blocks : blocks, extraction: hasUserWork ? current.extraction : 'MinerU', sourceMode: hasUserWork ? (current.sourceMode || 'pdf') : 'mineru' };
      });
      setStatus(`MinerU structure ready: ${blocks.length} blocks. You can switch Reader source without discarding either version.`);
    } catch (err) { setError(err.message); } finally { endTask(token); }
  }
  function switchSourceMode(mode) {
    if (!paper || paper.sourceMode === mode) return;
    commitPaper(current => mode === 'mineru'
      ? { ...current, pdfBlocks: current.blocks, blocks: current.mineruBlocks, extraction: 'MinerU', sourceMode: 'mineru' }
      : { ...current, mineruBlocks: current.blocks, blocks: current.pdfBlocks, extraction: 'PDF.js', sourceMode: 'pdf' });
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
      await saveChain.current;
      await api.clearData();
      const data = await api.bootstrap();
      paperRef.current = null; setPaper(null); setLibrary([]); setGlossary([]); setSettings(data.settings);
      setSelection(null); setSearch(''); setUndo([]); setTab('Paper'); setActiveBlock(1); setPageNumber(1); setDisplayMode('bilingual');
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
    const raw = selected?.toString() || '';
    const text = raw.trim();
    if (!text || text.length > 3000) return;
    const anchor = selected.anchorNode?.nodeType === Node.ELEMENT_NODE ? selected.anchorNode : selected.anchorNode?.parentElement;
    const element = anchor?.closest('[data-block-id]');
    const range = selected.rangeCount ? selected.getRangeAt(0) : null;
    if (!element || !range || !element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const block = paperRef.current?.blocks.find(item => item.id === Number(element.dataset.blockId));
    const kind = element.dataset.kind || 'source';
    const source = kind === 'translation' ? block?.translation : block?.text;
    const before = document.createRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
    const measured = before.toString().length + raw.length - raw.trimStart().length;
    const first = source?.indexOf(text) ?? -1;
    const offset = source?.slice(measured, measured + text.length) === text ? measured : first >= 0 && first === source.lastIndexOf(text) ? first : null;
    const rect = range.getBoundingClientRect();
    setSelection({ id: block?.id ?? null, kind, text, offset, scope: 'reader', rect: { x: rect.left, y: rect.top } });
    const saved = block?.notes?.find(note => note.text === text && note.offset === offset && (note.kind || 'source') === kind);
    setSelectionResult(null); setInspector(true); setNoteDraft(saved?.body || '');
  }
  function addHighlight(color) {
    if (!selection) return;
    if (['summarySource', 'summaryTarget', 'fullTranslation'].includes(selection.scope)) {
      if (!validViewAnchor(paper, selection)) { setError('This selection cannot be anchored exactly in the saved document.'); return; }
      rememberUndo();
      const saved = paper.viewHighlights || [];
      const exists = saved.find(item => item.scope === selection.scope && item.text === selection.text && item.offset === selection.offset && item.color === color);
      commitPaper(current => ({ ...current, viewHighlights: exists ? saved.filter(item => item.id !== exists.id) : [...saved, { id: crypto.randomUUID(), scope: selection.scope, text: selection.text, offset: selection.offset, color }] }));
      setStatus(exists ? 'Highlight removed.' : 'Highlight saved in the annotation list.');
      return;
    }
    const block = paper.blocks.find(item => item.id === selection.id);
    const key = selection.kind === 'translation' ? 'translationHighlights' : 'highlights';
    const source = selection.kind === 'translation' ? block?.translation : block?.text;
    if (!['reader', 'paper'].includes(selection.scope) || !block || !Number.isInteger(selection.offset) || source?.slice(selection.offset, selection.offset + selection.text.length) !== selection.text) { setError('This exact selection cannot be anchored to one source block.'); return; }
    rememberUndo();
    const highlights = block[key] || [];
    const exists = highlights.some(item => item.text === selection.text && item.offset === selection.offset && item.color === color);
    updateBlock(block.id, { [key]: exists ? highlights.filter(item => !(item.text === selection.text && item.offset === selection.offset && item.color === color)) : [...highlights, { text: selection.text, offset: selection.offset, color }] });
    setStatus(exists ? 'Highlight removed; its notes were kept.' : 'Highlight saved.');
  }
  function saveNote() {
    if (!selection || !noteDraft.trim()) return;
    if (['summarySource', 'summaryTarget', 'fullTranslation'].includes(selection.scope)) {
      if (!validViewAnchor(paper, selection)) { setError('This note needs an exact selection in the saved document.'); return; }
      rememberUndo();
      const saved = paper.viewNotes || [];
      const existing = saved.find(item => item.scope === selection.scope && item.text === selection.text && item.offset === selection.offset);
      commitPaper(current => ({ ...current, viewNotes: existing ? saved.map(item => item.id === existing.id ? { ...item, body: noteDraft.trim() } : item) : [...saved, { id: crypto.randomUUID(), scope: selection.scope, text: selection.text, offset: selection.offset, body: noteDraft.trim() }] }));
      setStatus(existing ? 'Note updated.' : 'Note saved in the annotation list.');
      return;
    }
    const block = paper.blocks.find(item => item.id === selection.id);
    if (!['reader', 'paper'].includes(selection.scope) || !block || !Number.isInteger(selection.offset)) { setError('This note needs an exact source block selection.'); return; }
    rememberUndo();
    const existing = block.notes?.find(note => note.text === selection.text && note.offset === selection.offset && (note.kind || 'source') === selection.kind);
    updateBlock(block.id, { notes: existing ? block.notes.map(note => note.id === existing.id ? { ...note, body: noteDraft.trim(), needsReview: false } : note) : [...(block.notes || []), { id: crypto.randomUUID(), text: selection.text, offset: selection.offset, kind: selection.kind, body: noteDraft.trim() }] });
    setStatus(existing ? 'Note updated.' : 'Note saved.');
  }
  function removeNote(blockId, noteId) { const block = paper.blocks.find(item => item.id === blockId); if (!block) return; rememberUndo(); updateBlock(blockId, { notes: (block.notes || []).filter(note => note.id !== noteId) }); }
  function removeHighlight(blockId, highlight, kind = 'source') { const block = paper.blocks.find(item => item.id === blockId); if (!block) return; const key = kind === 'translation' ? 'translationHighlights' : 'highlights'; rememberUndo(); updateBlock(blockId, { [key]: (block[key] || []).filter(item => item !== highlight) }); }
  function removeViewNote(id) { rememberUndo(); commitPaper(current => ({ ...current, viewNotes: (current.viewNotes || []).filter(item => item.id !== id) })); }
  function removeViewHighlight(id) { rememberUndo(); commitPaper(current => ({ ...current, viewHighlights: (current.viewHighlights || []).filter(item => item.id !== id) })); }
  function addTerm() {
    if (!selection || !termDraft.trim()) return;
    setGlossary(current => [{ source: selection.text.slice(0, 160), target: termDraft.trim().slice(0, 300), sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage }, ...current].slice(0, 500));
    setTermDraft(''); setStatus('Term saved for future translations.');
  }
  function bookmark(id) { const block = paper.blocks.find(item => item.id === id); rememberUndo(); updateBlock(id, { bookmark: !block.bookmark }); }
  function navigate(id) { setActiveBlock(id); setTab('Reader'); commitPaper(current => ({ ...current, position: { ...current.position, block: id } })); setTimeout(() => document.getElementById(`block-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
  function navigateView(scope) {
    setTab(scope === 'fullTranslation' ? 'Full Translation' : 'Summary');
    const target = scope === 'fullTranslation' ? '.content-column .document-preview' : scope === 'summaryTarget' ? '.summary-card.translated' : '.summary-card';
    setTimeout(() => document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  function modifyBlocks(transform) {
    if (paper.sourceMode === 'mineru') { setError('MinerU controls this document structure. Edit an exported Markdown copy instead.'); return; }
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
    const selected = window.getSelection();
    const raw = selected?.toString() || '';
    const text = raw.trim();
    const range = selected?.rangeCount ? selected.getRangeAt(0) : null;
    if (!text || text.length > 3000 || !range || !event.currentTarget.contains(range.startContainer) || !event.currentTarget.contains(range.endContainer)) return;
    let id = null;
    let offset = null;
    if (scope === 'paper') {
      const matches = (paperRef.current?.blocks || []).filter(block => block.text.includes(text));
      if (matches.length === 1) {
        id = matches[0].id;
        const first = matches[0].text.indexOf(text);
        if (first === matches[0].text.lastIndexOf(text)) offset = first;
      }
    } else {
      const source = scope === 'summarySource' ? paperRef.current?.summary?.source : scope === 'summaryTarget' ? paperRef.current?.summary?.target : paperRef.current?.connectedTranslation;
      const matches = [];
      let searchAt = 0;
      while (source && searchAt < source.length) {
        const at = source.indexOf(text, searchAt);
        if (at < 0) break;
        matches.push(at); searchAt = at + text.length;
      }
      const before = document.createRange(); before.selectNodeContents(event.currentTarget); before.setEnd(range.startContainer, range.startOffset);
      const ordinal = before.toString().split(text).length - 1;
      offset = matches[ordinal] ?? null;
    }
    const rect = range.getBoundingClientRect();
    setSelection({ id, kind, text, offset, scope, rect: { x: rect.left, y: rect.top } });
    const saved = paperRef.current?.viewNotes?.find(note => note.scope === scope && note.text === text && note.offset === offset);
    setSelectionResult(null); setNoteDraft(saved?.body || ''); setInspector(true);
  }
  function mergeBlock(id) { if (id <= 1) return; modifyBlocks(blocks => blocks.filter(item => item.id !== id).map(item => item.id === id - 1 ? mergeBlocks(item, blocks.find(block => block.id === id)) : item)); }
  function mergeNextBlock(id) { if (id >= paper.blocks.length) return; modifyBlocks(blocks => blocks.filter(item => item.id !== id + 1).map(item => item.id === id ? mergeBlocks(item, blocks.find(block => block.id === id + 1)) : item)); }
  const outline = useMemo(() => paper?.blocks.filter(block => block.heading) || [], [paper]);
  const sections = useMemo(() => sectionRanges(paper?.blocks || []), [paper]);
  const referenceIDs = useMemo(() => referenceBlockIds(paper?.blocks || []), [paper]);
  const extractionIssues = useMemo(() => qualityIssues(paper?.blocks || [], referenceIDs), [paper, referenceIDs]);
  const filteredLibrary = library.filter(item => `${item.name} ${(item.tags || []).join(' ')}`.toLowerCase().includes(librarySearch.toLowerCase()));
  const visibleBlocks = paper?.blocks.filter(block => !search || `${block.text} ${block.translation}`.toLowerCase().includes(search.toLowerCase())) || [];
  const translatedCount = paper?.blocks.filter(block => block.status === 'ok' && !block.heading && !block.resource && !referenceIDs.has(block.id)).length || 0;
  const translatableCount = paper?.blocks.filter(block => !block.heading && !block.resource && !referenceIDs.has(block.id)).length || 0;
  const currentSection = sections.findLast(section => section.startId <= activeBlock);
  const currentSectionIds = currentSection?.ids || [];
  const abstractConclusionIds = sections.filter(section => /abstract|conclusion|摘要|结论/i.test(section.title)).flatMap(section => section.ids);

  if (!ready || !settings) return <div className="loading">Opening PaperBridge…</div>;
  return <div data-display-mode={displayMode} onDragOver={event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); }} onDrop={dropPdf} className={`app ${focus ? 'focus' : ''} ${!sidebar ? 'no-sidebar' : ''} ${!inspector ? 'no-inspector' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><img src="./brand.png" alt="" /><div><strong>PaperBridge</strong><small>Papers across languages</small><em>● Private by design</em></div></div>
      <div className="sidebar-scroll">
        <div className="side-group"><div className="side-label">SOURCE</div><button className="side-primary" onClick={openFile}><FilePlus2 size={16} /> Open PDF</button><button className="side-action" onClick={() => setModal('paste')}><FileText size={15} /> Paste Text</button><button className="side-action" onClick={loadPractice}><BookOpen size={15} /> Try a Practice Paper</button></div>
        <div className="side-group"><div className="side-label">LIBRARY <button title="Open library" onClick={() => setModal('library')}><Library size={15} /></button></div><input className="side-search" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Search papers or tags" />{filteredLibrary.slice(0, 12).map(item => <button key={item.id} className={`library-row ${paper?.id === item.id ? 'selected' : ''}`} onClick={() => loadPaper(item.id).catch(err => setError(err.message))}><span>{short(item.name, 29)}</span><small>{item.blockCount} blocks</small></button>)}</div>
        {paper && <><div className="side-group"><div className="side-label">DOCUMENT</div><strong className="side-title">{paper.name}</strong><div className="side-stat"><span>Blocks</span><b>{paper.blocks.length}</b></div><div className="side-stat"><span>Translated</span><b>{translatedCount}</b></div><div className="side-stat"><span>Parser</span><b>{paper.extraction}</b></div></div><div className="side-group"><div className="side-label">OUTLINE</div>{outline.slice(0, 60).map(block => <button className="outline-row" key={block.id} onClick={() => navigate(block.id)}><span>{short(block.text, 48)}</span><small>{block.page || block.id}</small></button>)}{!outline.length && <p className="side-hint">No headings detected.</p>}</div><div className="side-group"><div className="side-label">BOOKMARKS</div>{paper.blocks.filter(block => block.bookmark).map(block => <button className="outline-row" key={block.id} onClick={() => navigate(block.id)}>{short(block.text, 52)}</button>)}</div></>}
      </div>
      <div className="sidebar-footer"><button onClick={() => setModal('setup')}><Download size={16} /> Local AI setup</button><button onClick={() => setModal('settings')}><Settings2 size={16} /> Settings</button><button onClick={() => setModal('glossary')}><Languages size={16} /> Saved Terminology</button></div>
    </aside>
    <main className="workspace">
      <header className="header"><div className="title-row"><button className="icon-button panel-toggle" title="Toggle sidebar" onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button><div className="title-wrap"><h1>{paper?.name || 'PaperBridge'}</h1><p>{paper ? `${settings.sourceLanguage} → ${settings.targetLanguage} · ${paper.extraction} · ${paper.blocks.length} blocks` : 'A local space for academic reading'}</p></div><div className={`service ${ollamaError ? 'offline' : ''}`} title={ollamaError || 'Local Ollama is available'}>● {ollamaError ? 'Ollama unavailable' : 'Ollama Ready'}</div><button className="icon-button" title="Toggle inspector" onClick={() => setInspector(!inspector)}>{inspector ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div>
      {paper && <div className="header-tools"><nav className="tabs">{['Paper', 'Reader', 'Original', 'Summary', 'Full Translation'].map(name => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</nav><div className="toolbar-actions">{busy ? <button className="button danger" onClick={cancelTask}><Square size={14} /> Stop</button> : <button className="button coral" onClick={() => translateBlocks(paper.blocks.map(block => block.id))}><Languages size={16} /> {translatedCount ? 'Resume Translation' : 'Translate Paper'}</button>}<button className="button ghost" onClick={() => setModal('more')}>More ···</button></div></div>}
      </header>
      <div className="main-scroll" ref={mainScrollRef} onScroll={saveMainScroll}>
        {error && <Notice tone="error" onClose={() => setError('')}>{error}</Notice>}
        {updateInfo?.status === 'available' && <div className="update-banner" role="status"><div><strong>PaperBridge for Windows {updateInfo.latestVersion} is available</strong><p>Review the official release before downloading. Your papers remain on this computer.</p></div><button className="button blue" onClick={openUpdateRelease}>View release</button><button className="button ghost" onClick={() => setUpdateInfo(null)}>Later</button></div>}
        {busy && <Notice>{busy.label}{progress?.total ? ` · ${progress.done}/${progress.total}` : ''}</Notice>}
        {paper && status && <Notice>{status}</Notice>}
        {!paper && <div className="welcome"><img src="./brand.png" alt="" /><h1>Read across languages, locally.</h1><p>Keep the original paper nearby while translating, annotating, and exploring with local models.</p><div className="row"><button className="button blue" onClick={openFile}><FolderOpen size={17} /> Open PDF</button><button className="button outline" onClick={() => setModal('paste')}>Paste Text</button><button className="button outline" onClick={loadPractice}>Try a Practice Paper</button><button className="button outline" onClick={() => setModal('setup')}>Set up local AI</button></div><p className="welcome-note">Reading and notes work without AI. One-click setup detects and installs missing local tools.</p></div>}
        {paper && tab === 'Paper' && <div className="content-column">
          <div className="section-heading"><div><h2>Paper overview</h2><p>Source-linked reading map · generated from detected section headings</p></div><button className="button outline" onClick={() => setTab('Reader')}>Open Reader</button></div>
          {paper.mineruBlocks && <div className="source-mode row"><span>Reader source: {paper.sourceMode === 'mineru' ? 'MinerU Markdown' : 'PDF text'}</span><button className="button outline" onClick={() => switchSourceMode(paper.sourceMode === 'mineru' ? 'pdf' : 'mineru')}>Switch to {paper.sourceMode === 'mineru' ? 'PDF text' : 'MinerU Markdown'}</button></div>}
          <div className="reading-map">{readingMap(paper.blocks).map(entry => <button key={entry.label} onClick={() => navigate(entry.blockId)}><small>{entry.label}</small><strong>{entry.section}</strong><p>{short(entry.excerpt, 190)}</p><span>Read source block {entry.blockId} →</span></button>)}</div>
          {extractionIssues.length > 0 && <div className="quality-list"><h3>Extraction check · {extractionIssues.length} possible issue(s)</h3>{extractionIssues.slice(0, 20).map(issue => <button key={issue.id} onClick={() => navigate(issue.id)}>Review block {issue.id}: {issue.reason}</button>)}</div>}
          <div className="section-heading smaller"><div><h2>Document preview</h2><p>{paper.mineruMarkdown ? 'MinerU Markdown with structure and formulas' : paper.type === 'pdf' ? 'Exact source pages are available in Original' : 'Pasted source text'}</p></div>{paper.type === 'pdf' && <button className="button outline" onClick={() => setTab('Original')}>Original PDF</button>}</div>
          <article className="document-preview" onMouseUp={event => captureViewSelection(event, 'paper', 'source')}>{paper.mineruMarkdown ? <Markdown>{paper.mineruMarkdown}</Markdown> : paper.blocks.slice(0, 12).map(block => block.heading ? <h3 key={block.id}>{block.text}</h3> : <p key={block.id}>{block.text}</p>)}{paper.blocks.length > 12 && <button className="text-button" onClick={() => setTab('Reader')}>Continue in Reader →</button>}</article>
        </div>}
        {paper && tab === 'Reader' && <div className="reader-layout"><div className="reader-top"><div><h2>{displayMode === 'bilingual' ? 'Bilingual Reader' : displayMode === 'source' ? 'Original Reader' : 'Translation Reader'}</h2><p>{translatedCount} of {translatableCount} blocks translated</p></div><div className="row"><select className="reader-mode-select" aria-label="Reading mode" value={displayMode} onChange={event => changeDisplayMode(event.target.value)}><option value="bilingual">Bilingual</option><option value="source">Original</option><option value="translation">Translation</option></select><input ref={searchRef} className="search" placeholder="Search paper  Ctrl+F" value={search} onChange={event => changeSearch(event.target.value)} /><button className="icon-button" title="Focus reading" onClick={toggleFocus}><Focus size={18} /></button></div></div><div className="reader-list" style={{ '--reader-font': `${settings.fontSize}px`, '--reader-line': settings.lineHeight, '--reader-width': `${settings.readingWidth}px` }} onMouseUp={captureSelection}>{visibleBlocks.map(block => <article id={`block-${block.id}`} key={block.id} className={`block ${block.heading ? 'heading-block' : ''} ${activeBlock === block.id ? 'current' : ''}`} onClick={() => { setActiveBlock(block.id); if (paper.position?.block !== block.id) commitPaper(current => ({ ...current, position: { ...current.position, block: block.id } })); }}><div className="block-header"><span>{block.page ? `PAGE ${block.page} · ` : ''}BLOCK {block.id}</span><div className="row"><button className={`mini-action ${block.bookmark ? 'bookmarked' : ''}`} title="Bookmark" onClick={event => { event.stopPropagation(); bookmark(block.id); }}><Bookmark size={15} fill={block.bookmark ? 'currentColor' : 'none'} /></button><button className="mini-action" title="Edit source" disabled={paper.sourceMode === 'mineru'} onClick={event => { event.stopPropagation(); setEdit({ id: block.id, text: block.text }); }}><Pencil size={15} /></button><button className="mini-action" title="Translate or retry block" onClick={event => { event.stopPropagation(); translateBlocks([block.id]); }}><Languages size={15} /></button><button className="mini-action" title="Explain full paragraph" disabled={block.heading || block.resource} onClick={event => { event.stopPropagation(); setActiveBlock(block.id); explainBlock(block.id); }}><Sparkles size={15} /></button></div></div>{edit?.id === block.id ? <div className="edit-area"><textarea value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })} /><div className="row"><button className="button blue" onClick={saveEdit}>Save edit</button><button className="button ghost" onClick={() => setEdit(null)}>Cancel</button><button className="button ghost" onClick={() => splitBlock(block.id)}><Scissors size={15} /> Split</button><button className="button ghost" onClick={() => reflowParagraph(block.id)}>Reflow at full sentences</button><button className="button ghost" disabled={block.id === 1} onClick={() => mergeBlock(block.id)}><Merge size={15} /> Merge previous</button><button className="button ghost" disabled={block.id >= paper.blocks.length} onClick={() => mergeNextBlock(block.id)}><Merge size={15} /> Merge next</button></div></div> : <><div className="source-text" data-block-id={block.id} data-kind="source">{block.sourceMarkdown ? <Markdown>{block.sourceMarkdown}</Markdown> : withHighlight(block.text, block.highlights)}</div>{!block.heading && !block.resource && !referenceIDs.has(block.id) && <div className={`translation-text ${block.status === 'ok' ? 'done' : ''}`} data-block-id={block.id} data-kind="translation">{block.status === 'ok' ? (block.translationMarkdown ? <Markdown>{block.translationMarkdown}</Markdown> : withHighlight(block.translation, block.translationHighlights)) : block.status === 'failed' ? <span className="failure"><AlertCircle size={15} /> {block.error || 'Translation failed'} <button onClick={() => translateBlocks([block.id])}>Retry</button></span> : <span className="pending">Translation pending · select the translate button to begin</span>}</div>}</>}{block.notes?.length > 0 && <div className="block-notes">{block.notes.map(note => <p key={note.id}><MessageSquareText size={14} /> <b>{short(note.text, 70)}</b> {note.body}</p>)}</div>}</article>)}{!visibleBlocks.length && <Empty title="No matching blocks" body="Try another search term." />}</div>{undo.length > 0 && <button className="undo-button" onClick={() => { commitPaper(undo.at(-1)); setUndo(previous => previous.slice(0, -1)); }}><Undo2 size={16} /> Undo last change</button>}</div>}
        {paper && tab === 'Original' && <PdfView paper={paper} pageNumber={pageNumber} onRendered={restoreMainScroll} onPage={number => { restoringScroll.current = true; setPageNumber(number); commitPaper(current => ({ ...current, position: { ...current.position, page: number } })); }} onSelect={text => { const normalized = text.replace(/\s+/g, ' ').trim(); if (!normalized) return; const matches = paper.blocks.filter(item => item.page <= pageNumber && (item.endPage || item.page) >= pageNumber && item.text.includes(normalized)); const block = matches.length === 1 ? matches[0] : null; const first = block?.text.indexOf(normalized) ?? -1; const offset = first >= 0 && first === block.text.lastIndexOf(normalized) ? first : null; setSelection({ id: block?.id ?? null, kind: 'source', scope: 'pdf', page: pageNumber, text: normalized, offset }); setSelectionResult(null); setInspector(true); }} />}
        {paper && tab === 'Summary' && <SummaryView paper={paper} busy={busy} summarize={summarize} navigate={navigate} onSelect={captureViewSelection} />}
        {paper && tab === 'Full Translation' && <div className="content-column"><div className="section-heading"><div><h2>Connected full translation</h2><p>A separate document-wide pass for consistent terminology</p></div><button className="button coral" disabled={!!busy} onClick={() => fullTranslation(!!paper.connectedTranslation)}><Languages size={16} /> {paper.connectedTranslation ? 'Regenerate' : 'Translate full paper'}</button></div>{paper.connectedStale && <Notice tone="error">The source changed after this translation. Regenerate to update it.</Notice>}{paper.connectedTranslation ? <article className="document-preview" onMouseUp={event => captureViewSelection(event, 'fullTranslation', 'translation')}><Markdown>{paper.connectedTranslation}</Markdown></article> : <Empty title="No full translation yet" body="This optional pass translates longer passages with context. The bilingual reader remains available separately." />}</div>}
      </div>
    </main>
    <aside className="inspector"><div className="inspector-title"><h2>Research Inspector</h2><button className="icon-button" onClick={() => setInspector(false)}><X size={16} /></button></div>{selection ? <div className="inspector-scroll"><div className="inspector-section"><small>{selection.scope === 'pdf' ? `ORIGINAL PDF · PAGE ${selection.page}` : selection.id ? `SELECTED TEXT · BLOCK ${selection.id}` : `SELECTED TEXT · ${selection.scope}`}</small><blockquote>{short(selection.text, 350)}</blockquote><div className="action-grid"><button onClick={() => runSelection('translate')}><Languages size={16} /> Translate</button><button onClick={() => runSelection('explain')}><Sparkles size={16} /> Explain</button></div></div>{selectionResult && <div className={`inspector-result ${selectionResult.kind}`}><small>{selectionResult.kind.toUpperCase()}</small><p>{selectionResult.output}</p></div>}<div className="inspector-section"><small>HIGHLIGHT</small><div className="row"><button className="highlight amber" title="Amber" onClick={() => addHighlight('amber')}><Highlighter size={16} /></button><button className="highlight blue" title="Blue" onClick={() => addHighlight('blue')}><Highlighter size={16} /></button><button className="highlight coral" title="Coral" onClick={() => addHighlight('coral')}><Highlighter size={16} /></button></div></div><div className="inspector-section"><small>NOTE</small><textarea placeholder="What should you remember?" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} /><button className="button blue" onClick={saveNote}>Save note</button></div><div className="inspector-section"><small>SAVED TERMINOLOGY</small><input placeholder="Approved translation" value={termDraft} onChange={event => setTermDraft(event.target.value)} /><button className="button outline" onClick={addTerm}>Save term</button></div></div> : <div className="inspector-scroll"><p className="inspector-help">Select text in Reader to translate or explain an exact phrase, highlight it, attach a note, or save a term.</p>{paper && <><div className="inspector-section"><small>THIS PAPER</small><p>{paper.blocks.filter(block => block.bookmark).length} bookmarks · {paper.blocks.reduce((count, block) => count + (block.notes?.length || 0), 0)} notes</p></div><div className="inspector-section"><small>QUICK ACTIONS</small><button className="inspector-link" onClick={() => setModal('range')}>Choose translation range</button><button className="inspector-link" onClick={() => setModal('export')}>Export Markdown</button><button className="inspector-link" onClick={() => setModal('settings')}>Local AI settings</button></div></>}</div>}{paper && <ParagraphExplanation paper={paper} activeBlock={activeBlock} language={explanationLanguage} setLanguage={setExplanationLanguage} result={paragraphExplanation} onExplain={explainBlock} busy={busy} />}{paper && <SavedAnnotations paper={paper} navigate={navigate} navigateView={navigateView} removeNote={removeNote} removeHighlight={removeHighlight} removeViewNote={removeViewNote} removeViewHighlight={removeViewHighlight} />}</aside>
    {selection?.rect && !modal && <div className="selection-toolbar" style={{ left: Math.min(window.innerWidth - 275, Math.max(8, selection.rect.x)), top: Math.max(8, selection.rect.y - 44) }} onMouseDown={event => event.preventDefault()}><button disabled={!!busy} onClick={() => runSelection('translate')}><Languages size={14} /> Translate</button><button disabled={!!busy} onClick={() => runSelection('explain')}><Sparkles size={14} /> Explain</button><button onClick={() => { setInspector(true); document.querySelector('.inspector-section textarea')?.focus(); }}><MessageSquareText size={14} /> Notes</button><button aria-label="Close selection tools" onClick={() => setSelection(null)}><X size={14} /></button></div>}
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(''); }}><div className="modal"><div className="modal-head"><h2>{({ paste: 'Paste text', settings: 'Settings', setup: 'Local AI setup', glossary: 'Saved Terminology', library: 'Paper Library', libraryLabel: 'Edit Library Label', more: 'More tools', range: 'Translation range', export: 'Export Markdown', clearData: 'Remove Saved Data' })[modal]}</h2><button className="icon-button" onClick={() => setModal('')}><X size={19} /></button></div><div className="modal-body">
      {modal === 'paste' && <><p>Paste a passage or complete paper. It stays on this computer.</p><textarea className="paste-area" value={paste} onChange={event => setPaste(event.target.value)} placeholder="Paste academic text here…" /><button className="button blue" onClick={() => importText(paste)}>Open text</button></>}
      {modal === 'setup' && <SetupPanel settings={settings} progress={setupProgress} onSettings={updateSettings} onInstalled={() => refreshModels(settings)} />}
      {modal === 'settings' && <button className="button blue" onClick={() => setModal('setup')}><Download size={16} /> Detect and install local AI</button>}
      {modal === 'settings' && <><label>PDF extraction mode<select value={settings.pdfExtractionMode || 'mineruPreferred'} onChange={event => updateSettings({ pdfExtractionMode: event.target.value })}><option value="mineruPreferred">MinerU, then selectable PDF text</option><option value="mineruOnly">MinerU only</option><option value="pdfOnly">Selectable PDF text only (no OCR)</option></select></label><label>Quick lookup model<select value={settings.quickLookupModel || settings.translationModel} onChange={event => updateSettings({ quickLookupModel: event.target.value })}>{[...new Set([settings.quickLookupModel || settings.translationModel, ...models])].map(value => <option key={value}>{value}</option>)}</select></label></>}
      {modal === 'settings' && <><label>Ollama URL<input value={settings.ollamaBaseURL} onChange={event => updateSettings({ ollamaBaseURL: event.target.value })} /></label><button className="button outline" onClick={() => refreshModels(settings)}><RefreshCw size={15} /> Refresh models</button>{ollamaError && <Notice tone="error">{ollamaError}</Notice>}<div className="settings-grid"><label>Source language<select value={settings.sourceLanguage} onChange={event => updateSettings({ sourceLanguage: event.target.value })}>{languages.map(value => <option key={value}>{value}</option>)}</select></label><label>Target language<select value={settings.targetLanguage} onChange={event => updateSettings({ targetLanguage: event.target.value })}>{languages.map(value => <option key={value}>{value}</option>)}</select></label></div><button className="button ghost" onClick={() => updateSettings({ sourceLanguage: settings.targetLanguage, targetLanguage: settings.sourceLanguage })}><ArrowRightLeft size={15} /> Swap languages</button><div className="settings-grid">{[['translationModel', 'Translation model'], ['summaryModel', 'Summary model'], ['explainModel', 'Explanation model']].map(([key, label]) => <label key={key}>{label}<select value={settings[key]} onChange={event => updateSettings({ [key]: event.target.value })}>{[...new Set([settings[key], ...models])].map(value => <option key={value}>{value}</option>)}</select></label>)}</div><p className="settings-tip">Need a model? Enter its Ollama name and download it locally.</p><div className="row"><input value={pullModel} placeholder="translategemma:4b" onChange={event => setPullModel(event.target.value)} /><button className="button blue" onClick={async () => { try { await api.pullModel({ baseURL: settings.ollamaBaseURL, model: pullModel || 'translategemma:4b' }); refreshModels(settings); setPullProgress(null); } catch (err) { setError(err.message); } }}>Download model</button></div>{pullProgress && <p>{pullProgress.status} {pullProgress.total ? `${Math.round(100 * pullProgress.completed / pullProgress.total)}%` : ''}</p>}<label>MinerU executable<input value={settings.mineruExecutable} placeholder="mineru (from PATH)" onChange={event => updateSettings({ mineruExecutable: event.target.value })} /></label><div className="settings-grid"><label>Reader font size<input type="range" min="14" max="25" value={settings.fontSize} onChange={event => updateSettings({ fontSize: Number(event.target.value) })} />{settings.fontSize}px</label><label>Line spacing<input type="range" min="1.3" max="2.2" step="0.1" value={settings.lineHeight} onChange={event => updateSettings({ lineHeight: Number(event.target.value) })} />{settings.lineHeight}</label><label>Reading width<input type="range" min="560" max="1100" step="20" value={settings.readingWidth} onChange={event => updateSettings({ readingWidth: Number(event.target.value) })} />{settings.readingWidth}px</label></div></>}
      {modal === 'settings' && <div className="hardware-panel">
        <div className="row"><strong>Graphics acceleration</strong><button className="button outline" onClick={() => { api.graphicsStatus().then(setHardware); api.mineruRuntime(settings.mineruExecutable).then(setMineruRuntime); api.runningModels(settings.ollamaBaseURL).then(setRunningModels).catch(() => setRunningModels([])); }}><RefreshCw size={14} /> Check</button></div>
        <p>{hardware?.adapters?.length ? hardware.adapters.map(adapter => `${adapter.name} (${adapter.vendor})`).join(' · ') : 'No graphics adapter reported by Windows.'}</p>
        <p>{hardware?.cudaDriver?.length ? `NVIDIA driver detected: ${hardware.cudaDriver.map(device => `${device.name}, ${device.memoryMiB || '?'} MiB`).join('; ')}.` : hardware?.adapters?.some(adapter => adapter.vendor === 'AMD') ? 'AMD detected. Ollama may use supported ROCm or Vulkan hardware.' : 'Ollama chooses its available CPU or GPU backend automatically.'}</p>
        <p>{mineruRuntime?.checked ? `MinerU Python: PyTorch ${mineruRuntime.torch}; CUDA ${mineruRuntime.cuda ? `available (${mineruRuntime.devices.join(', ')})` : 'unavailable'}.` : mineruRuntime?.reason || 'Checking MinerU Python environment…'}</p>
        {runningModels.length > 0 && <p>Ollama loaded: {runningModels.map(model => `${model.name} · ${(model.sizeVram / 1024 ** 3).toFixed(1)} GB VRAM`).join('; ')}</p>}
        <label>MinerU backend<select value={settings.mineruBackend || 'auto'} onChange={event => updateSettings({ mineruBackend: event.target.value })}><option value="auto">Auto (MinerU selects available acceleration)</option><option value="pipeline">Pipeline compatibility mode</option></select></label>
      </div>}
      {modal === 'settings' && <div className="hardware-panel update-settings"><div className="row"><strong>Windows updates · {appVersion || 'unknown version'}</strong><button className="button outline" disabled={checkingUpdates} onClick={() => checkForUpdates(false)}><RefreshCw size={14} /> Check now</button></div><label><input type="checkbox" checked={settings.autoCheckUpdates !== false} onChange={event => updateSettings({ autoCheckUpdates: event.target.checked })} /> Check official Windows releases at most once per day</label>{updateStatus && <p role="status">{updateStatus}</p>}<p>New versions open on the official GitHub release page. This unsigned preview does not install updates automatically.</p></div>}
      {modal === 'glossary' && <><p>Approved terms guide future translations in the same language direction.</p><input placeholder="Search saved terms" value={glossarySearch} onChange={event => setGlossarySearch(event.target.value)} />{[...glossary.entries()].filter(([, term]) => `${term.source} ${term.target}`.toLowerCase().includes(glossarySearch.toLowerCase())).map(([index, term]) => <div className="term-row" key={`${term.source}-${index}`}><span><b>{term.source}</b> → {term.target}<small>{term.sourceLanguage} → {term.targetLanguage}</small></span><button className="icon-button" aria-label={`Remove ${term.source}`} onClick={() => setGlossary(current => current.filter((_, at) => at !== index))}><Trash2 size={16} /></button></div>)}{!glossary.length && <p>No saved terms yet. Select a phrase in Reader to add one.</p>}</>}
      {modal === 'library' && <LibraryView items={filteredLibrary} query={librarySearch} setQuery={setLibrarySearch} loadPaper={loadPaper} setModal={setModal} setError={setError} setLibraryEdit={setLibraryEdit} />}
      {modal === 'libraryLabel' && libraryEdit && <><p>Only the library label changes; the original PDF stays unchanged.</p><label>Title<input value={libraryEdit.name} onChange={event => setLibraryEdit({ ...libraryEdit, name: event.target.value })} /></label><label>Tags, separated by commas<input value={libraryEdit.tags} onChange={event => setLibraryEdit({ ...libraryEdit, tags: event.target.value })} /></label><div className="row"><button className="button blue" disabled={!libraryEdit.name.trim()} onClick={saveLibraryLabel}>Save label</button><button className="button outline" onClick={() => setModal('library')}>Cancel</button></div></>}
      {modal === 'more' && <div className="menu-list"><button onClick={() => setModal('range')}><Languages size={17} /> Translation Range</button><button onClick={() => { setModal(''); runMineru(); }} disabled={paper?.type !== 'pdf'}><FileText size={17} /> Parse with MinerU</button><button onClick={reextractAsNew} disabled={paper?.type !== 'pdf' || !!busy}><FilePlus2 size={17} /> Re-extract PDF as New Copy</button><button onClick={() => setModal('export')}><Download size={17} /> Export Markdown</button><button onClick={() => { setModal(''); toggleFocus(); }}><Focus size={17} /> {focus ? 'Exit Focus Reading' : 'Focus Reading'}</button><button onClick={() => setModal('settings')}><Settings2 size={17} /> Settings</button></div>}
      {modal === 'range' && <div className="menu-list">
        <button disabled={!!busy || !abstractConclusionIds.length} onClick={() => { setModal(''); translateBlocks(abstractConclusionIds); }}>Abstract & Conclusion <small>{abstractConclusionIds.length} blocks</small></button>
        <button disabled={!!busy || !currentSectionIds.length} onClick={() => { setModal(''); translateBlocks(currentSectionIds); }}>Current section: {currentSection?.title || 'Opening material'} <small>{currentSectionIds.length} blocks</small></button>
        {translationQueueRef.current && <button onClick={() => { prioritizeSection(currentSectionIds); setModal(''); }}>Prioritize current section in queue</button>}
        {sections.map(section => <button key={section.startId} disabled={!!busy} onClick={() => { setModal(''); translateBlocks(section.ids); }}>Choose section: {section.title}<small>{section.ids.length} blocks</small></button>)}
        <button disabled={!!busy} onClick={() => { setModal(''); translateBlocks(paper.blocks.map(block => block.id)); }}>All unfinished blocks <small>{paper.blocks.filter(block => block.status !== 'ok' && !referenceIDs.has(block.id)).length} blocks</small></button>
      </div>}
      {modal === 'settings' && <button className="button danger" disabled={!!busy} onClick={() => setModal('clearData')}>Remove all saved PaperBridge data…</button>}
      {modal === 'clearData' && <><p>This removes saved papers, translations, bookmarks, notes, terminology, and settings. Original PDF copies remain in the local workspace.</p><div className="row"><button className="button danger" onClick={clearSavedData}>Remove saved data</button><button className="button outline" onClick={() => setModal('settings')}>Cancel</button></div></>}
      {modal === 'export' && <div className="menu-list"><button onClick={exportBundle}><Download size={17} /> Export portable Markdown bundle</button>{[['original', 'Original Markdown'], ['translated', 'Translated Markdown'], ['bilingual', 'Bilingual Markdown'], ['analysis', 'Summary, sources and notes'], ...(paper.connectedTranslation ? [['full', 'Full Translation Markdown']] : [])].map(([kind, label]) => <button key={kind} onClick={() => exportMarkdown(kind)}><Download size={17} /> {label}</button>)}</div>}
    </div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
