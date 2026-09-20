import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { BookOpen, FilePlus2, FolderOpen, Search, Settings2, Languages, Bookmark, Highlighter, MessageSquareText, Download, X, PanelRightClose, PanelRightOpen, ArrowRightLeft, Play, Square, RefreshCw, FileText, Library, ChevronLeft, ChevronRight, List, Sparkles, Pencil, Trash2, Undo2, Merge, Scissors, Focus, PanelLeftClose, PanelLeftOpen, Check, AlertCircle } from 'lucide-react';
import { openPdf, extractPdf } from './pdf.mjs';
import { blocksFromText, readingMap, chunkText, isHeading } from './text.mjs';
import { translationSystem, translationPrompt, explainPrompt, summaryPrompt, protectMarkdown, restoreMarkdown, markdownTranslationPrompt } from './prompts.mjs';
import 'katex/dist/katex.min.css';
import './style.css';
import './hardware.css';

const api = window.paperBridge;
const languages = ['English', 'Simplified Chinese', 'Traditional Chinese', 'Japanese', 'Korean', 'French', 'German', 'Spanish', 'Italian', 'Portuguese', 'Russian'];
const sample = ['Abstract', 'This is a fictional practice document, not a published study. Use it to explore source-linked reading, translation, highlights, and notes without importing a personal paper.', '1 Introduction', 'Reading a paper across languages involves more than translating its sentences. Readers need to connect a claim to the method and evidence that support it.', '2 Methods', 'Start with the reading map, then open the linked source passage. Translate one paragraph when needed, or translate the whole document with a local Ollama model.', '3 Results', 'Selecting a phrase opens tools for translation, explanation, highlighting, and notes. This practice document contains no measured results or claims about model accuracy.', '4 Limitations', 'A summary is a reading aid, not a substitute for evidence. PDF text extraction and local models can make mistakes; compare uncertain passages with the Original PDF when one is available.', '5 Conclusion', 'Keep useful passages in bookmarks, retain your notes, and export the material you want to revisit. This sample requires no model until you choose an AI action.'];
const markdownPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

function safeMarkdownUrl(url, key) { return key === 'src' && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(url) ? url : defaultUrlTransform(url); }
function Markdown({ children }) { return <ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={rehypePlugins} urlTransform={safeMarkdownUrl}>{children || ''}</ReactMarkdown>; }
function short(text, count = 92) { return text?.length > count ? `${text.slice(0, count)}…` : text; }
function parsedMarkdownBlocks(markdown) {
  return markdown.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map((part, index) => ({ id: index + 1, text: part.replace(/!\[[^\]]*\]\([^)]+\)/g, '[Figure]').replace(/\$[^$]+\$/g, '[Formula]').replace(/[#*_`]/g, '').trim(), sourceMarkdown: part, page: null, heading: /^#{1,6}\s/.test(part), translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] }));
}
function withHighlight(text, highlights = []) {
  if (!highlights.length) return text;
  const spans = [];
  for (const highlight of highlights) {
    const at = text.indexOf(highlight.text);
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

function PdfView({ paper, pageNumber, onPage, onSelect }) {
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

function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(null);
  const [glossary, setGlossary] = useState([]);
  const [library, setLibrary] = useState([]);
  const [paper, setPaper] = useState(null);
  const paperRef = useRef(null);
  const [tab, setTab] = useState('Paper');
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
  const [selection, setSelection] = useState(null);
  const [selectionResult, setSelectionResult] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [termDraft, setTermDraft] = useState('');
  const [inspector, setInspector] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const [focus, setFocus] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [activeBlock, setActiveBlock] = useState(1);
  const [edit, setEdit] = useState(null);
  const [undo, setUndo] = useState(null);
  const [pullModel, setPullModel] = useState('');
  const [pullProgress, setPullProgress] = useState(null);
  const searchRef = useRef(null);
  const taskRef = useRef({ cancelled: false, ids: new Set() });
  const saveChain = useRef(Promise.resolve());
  const fileInputRef = useRef(null);

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
    paperRef.current = loaded; setPaper(loaded); setTab(loaded.position?.tab || 'Paper'); setSelection(null); setSearch(''); setActiveBlock(loaded.position?.block || 1); setPageNumber(loaded.position?.page || 1); setStatus(`Opened ${loaded.name}.`);
  };
  const updateBlock = (id, change) => commitPaper(current => ({ ...current, blocks: current.blocks.map(block => block.id === id ? { ...block, ...change } : block) }));
  const updateSettings = change => setSettings(previous => ({ ...previous, ...change }));
  const refreshModels = async config => {
    try { const values = await api.listModels(config.ollamaBaseURL); setModels(values); setOllamaError(''); return values; }
    catch (err) { setModels([]); setOllamaError(err.message); return []; }
  };
  useEffect(() => {
    api.bootstrap().then(data => { setSettings(data.settings); setGlossary(data.glossary); setLibrary(data.library); setReady(true); refreshModels(data.settings); api.graphicsStatus().then(setHardware).catch(() => {}); api.mineruRuntime(data.settings.mineruExecutable).then(setMineruRuntime).catch(() => {}); if (data.library.length) loadPaper(data.library[0].id).catch(err => setError(err.message)); }).catch(err => setError(err.message));
    const off = api.onProgress(data => { if (data.kind === 'model') setPullProgress(data); else setStatus(data.status || 'MinerU is processing the PDF…'); });
    return off;
  }, []);
  useEffect(() => { if (ready && settings) api.saveSettings(settings).catch(err => setError(err.message)); }, [settings, ready]);
  useEffect(() => { if (ready) api.saveGlossary(glossary).catch(err => setError(err.message)); }, [glossary, ready]);
  useEffect(() => { if (paperRef.current && paperRef.current.position?.tab !== tab) commitPaper(current => ({ ...current, position: { ...current.position, tab } })); }, [tab]);
  useEffect(() => {
    const key = event => {
      if (event.ctrlKey && event.key.toLowerCase() === 'o') { event.preventDefault(); openFile(); }
      if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setTab('Reader'); setTimeout(() => searchRef.current?.focus(), 0); }
      if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); setModal('library'); }
      if (event.key === 'Escape') { setModal(''); setSelection(null); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (!paper) return; const element = document.getElementById(`block-${activeBlock}`); if (tab === 'Reader' && element) element.scrollIntoView({ block: 'start' }); }, [tab]);

  async function openFile() {
    try {
      setBusy({ label: 'Opening PDF…' }); setError('');
      const imported = await api.importPdf();
      if (!imported) return;
      if (imported.existing) { await loadPaper(imported.existing); return; }
      const pdf = await openPdf(imported.bytes);
      const blocks = await extractPdf(pdf, (done, total) => setProgress({ done, total }));
      const document = { id: imported.id, name: imported.name, type: 'pdf', createdAt: new Date().toISOString(), blocks, tags: [], summary: null, connectedTranslation: '', position: { block: 1, page: 1, tab: 'Paper' }, extraction: 'PDF.js' };
      commitPaper(document); setTab('Paper'); setStatus(blocks.length ? `Extracted ${blocks.length} blocks from ${pdf.numPages} pages. Compare uncertain passages with Original PDF.` : 'No selectable text found. The exact original PDF is available; use MinerU for OCR.');
    } catch (err) { setError(err.message); } finally { setBusy(null); setProgress(null); }
  }
  async function importText(text, name = 'Pasted Text') {
    if (!text.trim()) return;
    const id = await sha256(text.trim());
    const existing = await api.loadPaper(id);
    if (existing) await loadPaper(existing);
    else { commitPaper({ id, name, type: 'text', createdAt: new Date().toISOString(), blocks: blocksFromText(text), tags: [], summary: null, connectedTranslation: '', position: { block: 1, page: 1, tab: 'Paper' }, extraction: 'Pasted text' }); setTab('Paper'); }
    setModal(''); setPaste('');
  }
  function startTask(label) { const token = { cancelled: false, ids: new Set() }; taskRef.current = token; setBusy({ label }); setProgress(null); setError(''); return token; }
  function endTask(token) { if (taskRef.current === token) { setBusy(null); setProgress(null); } }
  async function generate(model, prompt, system, token) {
    const requestId = crypto.randomUUID(); token.ids.add(requestId);
    try { const answer = await api.generate({ baseURL: settings.ollamaBaseURL, model, prompt, system, requestId }); if (token.cancelled) throw new Error('Cancelled'); return answer; }
    finally { token.ids.delete(requestId); }
  }
  function cancelTask() { taskRef.current.cancelled = true; for (const id of taskRef.current.ids) api.cancel(id); api.cancelMineru(); setBusy(null); setStatus('Task cancelled. Completed work was saved.'); }
  function matchingTerms(text) { return glossary.filter(term => term.sourceLanguage === settings.sourceLanguage && term.targetLanguage === settings.targetLanguage && text.toLowerCase().includes(term.source.toLowerCase())).slice(0, 24); }
  async function translateBlocks(ids) {
    if (!paperRef.current || busy) return;
    const token = startTask('Translating paragraphs…');
    const queue = paperRef.current.blocks.filter(block => ids.includes(block.id) && block.status !== 'ok' && !block.heading);
    if (!queue.length) { setStatus('This range is already complete.'); endTask(token); return; }
    try {
      if (settings.sourceLanguage !== settings.targetLanguage && !models.includes(settings.translationModel)) throw new Error(`Install ${settings.translationModel} in Ollama first.`);
      for (let index = 0; index < queue.length; index++) {
        if (token.cancelled) break;
        const block = queue[index];
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
    } catch (err) { setError(err.message); } finally { endTask(token); }
  }
  async function runSelection(kind) {
    if (!selection || busy) return;
    const token = startTask(kind === 'translate' ? 'Translating selection…' : 'Explaining selection…');
    try {
      const block = paperRef.current.blocks.find(item => item.id === selection.id);
      const output = kind === 'translate'
        ? await generate(settings.translationModel, translationPrompt(selection.text, selection.kind === 'translation' ? settings.targetLanguage : settings.sourceLanguage, selection.kind === 'translation' ? settings.sourceLanguage : settings.targetLanguage, matchingTerms(selection.text)), translationSystem(settings.targetLanguage), token)
        : await generate(settings.explainModel, explainPrompt(selection.text, block?.text || '', settings.targetLanguage), 'You are a patient academic explainer. Explain accurately and simply.', token);
      if (!token.cancelled) setSelectionResult({ kind, output });
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function summarize() {
    if (!paperRef.current || busy) return;
    const token = startTask('Summarizing paper…');
    try {
      const source = paperRef.current.blocks.filter(block => !/^references|bibliography$/i.test(block.text));
      const batches = []; let batch = []; let length = 0;
      for (const block of source) { if (length + block.text.length > 6000 && batch.length) { batches.push(batch); batch = []; length = 0; } batch.push(block); length += block.text.length; }
      if (batch.length) batches.push(batch);
      const partials = [];
      for (let i = 0; i < batches.length; i++) {
        if (token.cancelled) return;
        setBusy({ label: `Summarizing part ${i + 1} of ${batches.length}` }); setProgress({ done: i, total: batches.length + 1 });
        partials.push(await generate(settings.summaryModel, summaryPrompt(batches[i], settings.sourceLanguage), 'You are a careful academic paper assistant. Cite only supplied block IDs.', token));
      }
      const sourceSummary = partials.length === 1 ? partials[0] : await generate(settings.summaryModel, `Merge these partial summaries into a concise accurate paper summary. Retain only existing [block ID] citations.\n\n${partials.join('\n\n')}`, 'You are a careful academic paper assistant.', token);
      const targetSummary = settings.sourceLanguage === settings.targetLanguage ? sourceSummary : await generate(settings.translationModel, translationPrompt(sourceSummary, settings.sourceLanguage, settings.targetLanguage), translationSystem(settings.targetLanguage), token);
      if (!token.cancelled) { commitPaper(current => ({ ...current, summary: { source: sourceSummary, target: targetSummary, sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage } })); setStatus('Summary saved. Follow citations back to the source blocks.'); }
    } catch (err) { if (!token.cancelled) setError(err.message); } finally { endTask(token); }
  }
  async function fullTranslation() {
    if (!paperRef.current || busy) return;
    const token = startTask('Translating full paper…');
    try {
      const chunks = chunkText(paperRef.current.blocks.map(block => block.text).join('\n\n'), 4800);
      const outputs = [];
      for (let i = 0; i < chunks.length; i++) {
        if (token.cancelled) return;
        setBusy({ label: `Translating full paper · ${i + 1} of ${chunks.length}` }); setProgress({ done: i, total: chunks.length });
        outputs.push(await generate(settings.translationModel, translationPrompt(chunks[i], settings.sourceLanguage, settings.targetLanguage, matchingTerms(chunks[i])), translationSystem(settings.targetLanguage), token));
        commitPaper(current => ({ ...current, connectedTranslation: outputs.join('\n\n') }));
      }
      setStatus('Connected full-paper translation saved.');
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
    const source = paper.blocks.map(block => block.sourceMarkdown || block.text).join('\n\n');
    const translated = paper.blocks.map(block => block.translationMarkdown || block.translation || `[Untranslated block ${block.id}]`).join('\n\n');
    const bilingual = paper.blocks.map(block => `### ${block.id}\n\n${block.sourceMarkdown || block.text}\n\n${block.translationMarkdown || block.translation || '*Not translated*'}`).join('\n\n');
    const content = ({ original: source, translated, bilingual, analysis: `# ${paper.name}\n\n## Summary\n\n${paper.summary?.source || ''}\n\n${paper.summary?.target || ''}\n\n## Notes\n\n${paper.blocks.flatMap(block => (block.notes || []).map(note => `- Block ${block.id}: ${note.text} — ${note.body}`)).join('\n')}` })[kind];
    try { const destination = await api.exportMarkdown({ name: `${paper.name.replace(/\.pdf$/i, '')}-${kind}`, content }); if (destination) setStatus(`Exported ${destination}`); }
    catch (err) { setError(err.message); }
    setModal('');
  }
  function captureSelection() {
    const selected = window.getSelection();
    const text = selected?.toString().trim();
    if (!text || text.length > 3000) return;
    const element = selected.anchorNode?.parentElement?.closest('[data-block-id]');
    if (!element) return;
    setSelection({ id: Number(element.dataset.blockId), kind: element.dataset.kind || 'source', text });
    setSelectionResult(null); setInspector(true); setNoteDraft('');
  }
  function addHighlight(color) {
    if (!selection) return;
    const block = paper.blocks.find(item => item.id === selection.id);
    const key = selection.kind === 'translation' ? 'translationHighlights' : 'highlights';
    const source = selection.kind === 'translation' ? block?.translation : block?.text;
    if (!block || !source?.includes(selection.text)) return;
    setUndo(paper.blocks);
    const highlights = block[key] || [];
    const exists = highlights.some(item => item.text === selection.text && item.color === color);
    updateBlock(block.id, { [key]: exists ? highlights.filter(item => !(item.text === selection.text && item.color === color)) : [...highlights, { text: selection.text, color }] });
    setStatus(exists ? 'Highlight removed; its notes were kept.' : 'Highlight saved.');
  }
  function saveNote() {
    if (!selection || !noteDraft.trim()) return;
    const block = paper.blocks.find(item => item.id === selection.id);
    setUndo(paper.blocks);
    updateBlock(block.id, { notes: [...(block.notes || []), { id: crypto.randomUUID(), text: selection.text, body: noteDraft.trim() }] }); setNoteDraft('');
  }
  function addTerm() {
    if (!selection || !termDraft.trim()) return;
    setGlossary(current => [{ source: selection.text.slice(0, 160), target: termDraft.trim().slice(0, 300), sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage }, ...current].slice(0, 500));
    setTermDraft(''); setStatus('Term saved for future translations.');
  }
  function bookmark(id) { const block = paper.blocks.find(item => item.id === id); setUndo(paper.blocks); updateBlock(id, { bookmark: !block.bookmark }); }
  function navigate(id) { setActiveBlock(id); setTab('Reader'); commitPaper(current => ({ ...current, position: { ...current.position, block: id } })); setTimeout(() => document.getElementById(`block-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
  function modifyBlocks(transform) { setUndo(paper.blocks); commitPaper(current => ({ ...current, blocks: transform(current.blocks).map((block, index) => ({ ...block, id: index + 1 })) })); setEdit(null); }
  function saveEdit() { if (!edit?.text.trim()) return; modifyBlocks(blocks => blocks.map(block => block.id === edit.id ? { ...block, text: edit.text.trim(), translation: '', status: 'pending' } : block)); }
  function splitBlock(id) { const block = paper.blocks.find(item => item.id === id); const at = Math.max(block.text.lastIndexOf('. ', Math.floor(block.text.length / 2)), block.text.lastIndexOf('。', Math.floor(block.text.length / 2))); if (at < 10) { setError('No safe sentence boundary found. Edit this block manually.'); return; } modifyBlocks(blocks => blocks.flatMap(item => item.id === id ? [{ ...item, text: item.text.slice(0, at + 1), translation: '', status: 'pending' }, { ...item, text: item.text.slice(at + 1).trim(), translation: '', status: 'pending', bookmark: false, highlights: [], notes: [] }] : [item])); }
  function mergeBlock(id) { if (id <= 1) return; modifyBlocks(blocks => blocks.filter(item => item.id !== id).map(item => item.id === id - 1 ? { ...item, text: `${item.text} ${blocks.find(block => block.id === id).text}`, translation: '', status: 'pending', notes: [...(item.notes || []), ...(blocks.find(block => block.id === id).notes || [])] } : item)); }
  const outline = useMemo(() => paper?.blocks.filter(block => block.heading) || [], [paper]);
  const filteredLibrary = library.filter(item => `${item.name} ${(item.tags || []).join(' ')}`.toLowerCase().includes(librarySearch.toLowerCase()));
  const visibleBlocks = paper?.blocks.filter(block => !search || `${block.text} ${block.translation}`.toLowerCase().includes(search.toLowerCase())) || [];
  const translatedCount = paper?.blocks.filter(block => block.status === 'ok').length || 0;
  const currentHeadingIndex = paper?.blocks.findLastIndex(block => block.id <= activeBlock && block.heading) ?? -1;
  const sectionEnd = outline.find(block => block.id > activeBlock)?.id || Infinity;
  const sectionStart = currentHeadingIndex >= 0 ? paper.blocks[currentHeadingIndex]?.id || 1 : 1;
  const currentSectionIds = paper?.blocks.filter(block => block.id >= sectionStart && block.id < sectionEnd).map(block => block.id) || [];
  const abstractConclusionIds = paper?.blocks.filter((block, index, blocks) => { const prevHead = blocks.slice(0, index + 1).reverse().find(item => item.heading); return /abstract|conclusion|摘要|结论/i.test(prevHead?.text || ''); }).map(block => block.id) || [];

  if (!ready || !settings) return <div className="loading">Opening PaperBridge…</div>;
  return <div className={`app ${focus ? 'focus' : ''} ${!sidebar ? 'no-sidebar' : ''} ${!inspector ? 'no-inspector' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><img src="./brand.png" alt="" /><div><strong>PaperBridge</strong><small>Papers across languages</small><em>● Private by design</em></div></div>
      <div className="sidebar-scroll">
        <div className="side-group"><div className="side-label">SOURCE</div><button className="side-primary" onClick={openFile}><FilePlus2 size={16} /> Open PDF</button><button className="side-action" onClick={() => setModal('paste')}><FileText size={15} /> Paste Text</button><button className="side-action" onClick={() => importText(sample.join('\n\n'), 'Welcome to PaperBridge (practice sample)')}><BookOpen size={15} /> Try a Practice Paper</button></div>
        <div className="side-group"><div className="side-label">LIBRARY <button title="Open library" onClick={() => setModal('library')}><Library size={15} /></button></div><input className="side-search" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} placeholder="Search papers or tags" />{filteredLibrary.slice(0, 12).map(item => <button key={item.id} className={`library-row ${paper?.id === item.id ? 'selected' : ''}`} onClick={() => loadPaper(item.id).catch(err => setError(err.message))}><span>{short(item.name, 29)}</span><small>{item.blockCount} blocks</small></button>)}</div>
        {paper && <><div className="side-group"><div className="side-label">DOCUMENT</div><strong className="side-title">{paper.name}</strong><div className="side-stat"><span>Blocks</span><b>{paper.blocks.length}</b></div><div className="side-stat"><span>Translated</span><b>{translatedCount}</b></div><div className="side-stat"><span>Parser</span><b>{paper.extraction}</b></div></div><div className="side-group"><div className="side-label">OUTLINE</div>{outline.slice(0, 60).map(block => <button className="outline-row" key={block.id} onClick={() => navigate(block.id)}><span>{short(block.text, 48)}</span><small>{block.page || block.id}</small></button>)}{!outline.length && <p className="side-hint">No headings detected.</p>}</div><div className="side-group"><div className="side-label">BOOKMARKS</div>{paper.blocks.filter(block => block.bookmark).map(block => <button className="outline-row" key={block.id} onClick={() => navigate(block.id)}>{short(block.text, 52)}</button>)}</div></>}
      </div>
      <div className="sidebar-footer"><button onClick={() => setModal('settings')}><Settings2 size={16} /> Settings</button><button onClick={() => setModal('glossary')}><Languages size={16} /> Saved Terminology</button></div>
    </aside>
    <main className="workspace">
      <header className="header"><div className="title-row"><button className="icon-button panel-toggle" title="Toggle sidebar" onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button><div className="title-wrap"><h1>{paper?.name || 'PaperBridge'}</h1><p>{paper ? `${settings.sourceLanguage} → ${settings.targetLanguage} · ${paper.extraction} · ${paper.blocks.length} blocks` : 'A local space for academic reading'}</p></div><div className={`service ${ollamaError ? 'offline' : ''}`} title={ollamaError || 'Local Ollama is available'}>● {ollamaError ? 'Ollama unavailable' : 'Ollama Ready'}</div><button className="icon-button" title="Toggle inspector" onClick={() => setInspector(!inspector)}>{inspector ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button></div>
      {paper && <div className="header-tools"><nav className="tabs">{['Paper', 'Reader', 'Original', 'Summary', 'Full Translation'].map(name => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>)}</nav><div className="toolbar-actions">{busy ? <button className="button danger" onClick={cancelTask}><Square size={14} /> Stop</button> : <button className="button coral" onClick={() => translateBlocks(paper.blocks.map(block => block.id))}><Languages size={16} /> {translatedCount ? 'Resume Translation' : 'Translate Paper'}</button>}<button className="button ghost" onClick={() => setModal('more')}>More ···</button></div></div>}
      </header>
      <div className="main-scroll">
        {error && <Notice tone="error" onClose={() => setError('')}>{error}</Notice>}
        {busy && <Notice>{busy.label}{progress?.total ? ` · ${progress.done}/${progress.total}` : ''}</Notice>}
        {paper && status && <Notice>{status}</Notice>}
        {!paper && <div className="welcome"><img src="./brand.png" alt="" /><h1>Read across languages, locally.</h1><p>Keep the original paper nearby while translating, annotating, and exploring with local models.</p><div className="row"><button className="button blue" onClick={openFile}><FolderOpen size={17} /> Open PDF</button><button className="button outline" onClick={() => setModal('paste')}>Paste Text</button><button className="button outline" onClick={() => importText(sample.join('\n\n'), 'Welcome to PaperBridge (practice sample)')}>Try a Practice Paper</button></div><p className="welcome-note">Reading and notes work without AI. Translation and summaries use your own local Ollama installation.</p></div>}
        {paper && tab === 'Paper' && <div className="content-column">
          <div className="section-heading"><div><h2>Paper overview</h2><p>Source-linked reading map · generated from detected section headings</p></div><button className="button outline" onClick={() => setTab('Reader')}>Open Reader</button></div>
          {paper.mineruBlocks && <div className="source-mode row"><span>Reader source: {paper.sourceMode === 'mineru' ? 'MinerU Markdown' : 'PDF text'}</span><button className="button outline" onClick={() => switchSourceMode(paper.sourceMode === 'mineru' ? 'pdf' : 'mineru')}>Switch to {paper.sourceMode === 'mineru' ? 'PDF text' : 'MinerU Markdown'}</button></div>}
          <div className="reading-map">{readingMap(paper.blocks).map(entry => <button key={entry.label} onClick={() => navigate(entry.blockId)}><small>{entry.label}</small><strong>{entry.section}</strong><p>{short(entry.excerpt, 190)}</p><span>Read source block {entry.blockId} →</span></button>)}</div>
          <div className="section-heading smaller"><div><h2>Document preview</h2><p>{paper.mineruMarkdown ? 'MinerU Markdown with structure and formulas' : paper.type === 'pdf' ? 'Exact source pages are available in Original' : 'Pasted source text'}</p></div>{paper.type === 'pdf' && <button className="button outline" onClick={() => setTab('Original')}>Original PDF</button>}</div>
          <article className="document-preview">{paper.mineruMarkdown ? <Markdown>{paper.mineruMarkdown}</Markdown> : paper.blocks.slice(0, 12).map(block => block.heading ? <h3 key={block.id}>{block.text}</h3> : <p key={block.id}>{block.text}</p>)}{paper.blocks.length > 12 && <button className="text-button" onClick={() => setTab('Reader')}>Continue in Reader →</button>}</article>
        </div>}
        {paper && tab === 'Reader' && <div className="reader-layout"><div className="reader-top"><div><h2>Bilingual Reader</h2><p>{translatedCount} of {paper.blocks.filter(block => !block.heading).length} blocks translated</p></div><div className="row"><input ref={searchRef} className="search" placeholder="Search paper  Ctrl+F" value={search} onChange={event => setSearch(event.target.value)} /><button className="icon-button" title="Focus reading" onClick={() => { setFocus(!focus); setInspector(focus); }}><Focus size={18} /></button></div></div><div className="reader-list" style={{ '--reader-font': `${settings.fontSize}px`, '--reader-line': settings.lineHeight, '--reader-width': `${settings.readingWidth}px` }} onMouseUp={captureSelection}>{visibleBlocks.map(block => <article id={`block-${block.id}`} key={block.id} className={`block ${block.heading ? 'heading-block' : ''} ${activeBlock === block.id ? 'current' : ''}`} onClick={() => { setActiveBlock(block.id); if (paper.position?.block !== block.id) commitPaper(current => ({ ...current, position: { ...current.position, block: block.id } })); }}><div className="block-header"><span>{block.page ? `PAGE ${block.page} · ` : ''}BLOCK {block.id}</span><div className="row"><button className={`mini-action ${block.bookmark ? 'bookmarked' : ''}`} title="Bookmark" onClick={event => { event.stopPropagation(); bookmark(block.id); }}><Bookmark size={15} fill={block.bookmark ? 'currentColor' : 'none'} /></button><button className="mini-action" title="Edit source" onClick={event => { event.stopPropagation(); setEdit({ id: block.id, text: block.text }); }}><Pencil size={15} /></button><button className="mini-action" title="Translate or retry block" onClick={event => { event.stopPropagation(); translateBlocks([block.id]); }}><Languages size={15} /></button></div></div>{edit?.id === block.id ? <div className="edit-area"><textarea value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })} /><div className="row"><button className="button blue" onClick={saveEdit}>Save edit</button><button className="button ghost" onClick={() => setEdit(null)}>Cancel</button><button className="button ghost" onClick={() => splitBlock(block.id)}><Scissors size={15} /> Split</button><button className="button ghost" disabled={block.id === 1} onClick={() => mergeBlock(block.id)}><Merge size={15} /> Merge previous</button></div></div> : <><div className="source-text" data-block-id={block.id} data-kind="source">{block.sourceMarkdown ? <Markdown>{block.sourceMarkdown}</Markdown> : withHighlight(block.text, block.highlights)}</div>{!block.heading && <div className={`translation-text ${block.status === 'ok' ? 'done' : ''}`} data-block-id={block.id} data-kind="translation">{block.status === 'ok' ? (block.translationMarkdown ? <Markdown>{block.translationMarkdown}</Markdown> : withHighlight(block.translation, block.translationHighlights)) : block.status === 'failed' ? <span className="failure"><AlertCircle size={15} /> {block.error || 'Translation failed'} <button onClick={() => translateBlocks([block.id])}>Retry</button></span> : <span className="pending">Translation pending · select the translate button to begin</span>}</div>}</>}{block.notes?.length > 0 && <div className="block-notes">{block.notes.map(note => <p key={note.id}><MessageSquareText size={14} /> <b>{short(note.text, 70)}</b> {note.body}</p>)}</div>}</article>)}{!visibleBlocks.length && <Empty title="No matching blocks" body="Try another search term." />}</div>{undo && <button className="undo-button" onClick={() => { commitPaper(current => ({ ...current, blocks: undo })); setUndo(null); }}><Undo2 size={16} /> Undo last change</button>}</div>}
        {paper && tab === 'Original' && <PdfView paper={paper} pageNumber={pageNumber} onPage={number => { setPageNumber(number); commitPaper(current => ({ ...current, position: { ...current.position, page: number } })); }} onSelect={text => { const normalized = text.replace(/\s+/g, ' ').trim(); const block = paper.blocks.find(item => item.page === pageNumber && item.text.includes(normalized)) || paper.blocks.find(item => item.page === pageNumber); if (block && normalized) { setSelection({ id: block.id, kind: 'source', text: normalized }); setSelectionResult(null); setInspector(true); } }} />}
        {paper && tab === 'Summary' && <div className="content-column"><div className="section-heading"><div><h2>Paper summary</h2><p>Generated locally · verify each claim against the original</p></div><button className="button blue" disabled={!!busy} onClick={summarize}><Sparkles size={16} /> {paper.summary ? 'Regenerate' : 'Generate summary'}</button></div>{paper.summary ? <><article className="summary-card"><small>{paper.summary.sourceLanguage}</small><Markdown>{paper.summary.source}</Markdown></article><article className="summary-card translated"><small>{paper.summary.targetLanguage}</small><Markdown>{paper.summary.target}</Markdown></article><div className="source-links"><h3>Referenced source blocks</h3>{[...new Set((paper.summary.source.match(/\[\d+\]/g) || []).map(value => Number(value.slice(1, -1))))].filter(id => paper.blocks.some(block => block.id === id)).map(id => <button key={id} onClick={() => navigate(id)}>Block {id} · {short(paper.blocks.find(block => block.id === id)?.text, 110)}</button>)}</div></> : <Empty title="No summary yet" body="Generate a source and target language summary using your local model. Source block IDs help you check the claims." />}</div>}
        {paper && tab === 'Full Translation' && <div className="content-column"><div className="section-heading"><div><h2>Connected full translation</h2><p>A separate document-wide pass for consistent terminology</p></div><button className="button coral" disabled={!!busy} onClick={fullTranslation}><Languages size={16} /> {paper.connectedTranslation ? 'Regenerate' : 'Translate full paper'}</button></div>{paper.connectedTranslation ? <article className="document-preview"><Markdown>{paper.connectedTranslation}</Markdown></article> : <Empty title="No full translation yet" body="This optional pass translates longer passages with context. The bilingual reader remains available separately." />}</div>}
      </div>
    </main>
    <aside className="inspector"><div className="inspector-title"><h2>Research Inspector</h2><button className="icon-button" onClick={() => setInspector(false)}><X size={16} /></button></div>{selection ? <div className="inspector-scroll"><div className="inspector-section"><small>SELECTED TEXT · BLOCK {selection.id}</small><blockquote>{short(selection.text, 350)}</blockquote><div className="action-grid"><button onClick={() => runSelection('translate')}><Languages size={16} /> Translate</button><button onClick={() => runSelection('explain')}><Sparkles size={16} /> Explain</button></div></div>{selectionResult && <div className={`inspector-result ${selectionResult.kind}`}><small>{selectionResult.kind.toUpperCase()}</small><p>{selectionResult.output}</p></div>}<div className="inspector-section"><small>HIGHLIGHT</small><div className="row"><button className="highlight amber" title="Amber" onClick={() => addHighlight('amber')}><Highlighter size={16} /></button><button className="highlight blue" title="Blue" onClick={() => addHighlight('blue')}><Highlighter size={16} /></button><button className="highlight coral" title="Coral" onClick={() => addHighlight('coral')}><Highlighter size={16} /></button></div></div><div className="inspector-section"><small>NOTE</small><textarea placeholder="What should you remember?" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} /><button className="button blue" onClick={saveNote}>Save note</button></div><div className="inspector-section"><small>SAVED TERMINOLOGY</small><input placeholder="Approved translation" value={termDraft} onChange={event => setTermDraft(event.target.value)} /><button className="button outline" onClick={addTerm}>Save term</button></div></div> : <div className="inspector-scroll"><p className="inspector-help">Select text in Reader to translate or explain an exact phrase, highlight it, attach a note, or save a term.</p>{paper && <><div className="inspector-section"><small>THIS PAPER</small><p>{paper.blocks.filter(block => block.bookmark).length} bookmarks · {paper.blocks.reduce((count, block) => count + (block.notes?.length || 0), 0)} notes</p></div><div className="inspector-section"><small>QUICK ACTIONS</small><button className="inspector-link" onClick={() => setModal('range')}>Choose translation range</button><button className="inspector-link" onClick={() => setModal('export')}>Export Markdown</button><button className="inspector-link" onClick={() => setModal('settings')}>Local AI settings</button></div></>}</div>}</aside>
    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(''); }}><div className="modal"><div className="modal-head"><h2>{({ paste: 'Paste text', settings: 'Settings', glossary: 'Saved Terminology', library: 'Paper Library', more: 'More tools', range: 'Translation range', export: 'Export Markdown' })[modal]}</h2><button className="icon-button" onClick={() => setModal('')}><X size={19} /></button></div><div className="modal-body">
      {modal === 'paste' && <><p>Paste a passage or complete paper. It stays on this computer.</p><textarea className="paste-area" value={paste} onChange={event => setPaste(event.target.value)} placeholder="Paste academic text here…" /><button className="button blue" onClick={() => importText(paste)}>Open text</button></>}
      {modal === 'settings' && <><label>Ollama URL<input value={settings.ollamaBaseURL} onChange={event => updateSettings({ ollamaBaseURL: event.target.value })} /></label><button className="button outline" onClick={() => refreshModels(settings)}><RefreshCw size={15} /> Refresh models</button>{ollamaError && <Notice tone="error">{ollamaError}</Notice>}<div className="settings-grid"><label>Source language<select value={settings.sourceLanguage} onChange={event => updateSettings({ sourceLanguage: event.target.value })}>{languages.map(value => <option key={value}>{value}</option>)}</select></label><label>Target language<select value={settings.targetLanguage} onChange={event => updateSettings({ targetLanguage: event.target.value })}>{languages.map(value => <option key={value}>{value}</option>)}</select></label></div><button className="button ghost" onClick={() => updateSettings({ sourceLanguage: settings.targetLanguage, targetLanguage: settings.sourceLanguage })}><ArrowRightLeft size={15} /> Swap languages</button><div className="settings-grid">{[['translationModel', 'Translation model'], ['summaryModel', 'Summary model'], ['explainModel', 'Explanation model']].map(([key, label]) => <label key={key}>{label}<select value={settings[key]} onChange={event => updateSettings({ [key]: event.target.value })}>{[...new Set([settings[key], ...models])].map(value => <option key={value}>{value}</option>)}</select></label>)}</div><p className="settings-tip">Need a model? Enter its Ollama name and download it locally.</p><div className="row"><input value={pullModel} placeholder="translategemma:4b" onChange={event => setPullModel(event.target.value)} /><button className="button blue" onClick={async () => { try { await api.pullModel({ baseURL: settings.ollamaBaseURL, model: pullModel || 'translategemma:4b' }); refreshModels(settings); setPullProgress(null); } catch (err) { setError(err.message); } }}>Download model</button></div>{pullProgress && <p>{pullProgress.status} {pullProgress.total ? `${Math.round(100 * pullProgress.completed / pullProgress.total)}%` : ''}</p>}<label>MinerU executable<input value={settings.mineruExecutable} placeholder="mineru (from PATH)" onChange={event => updateSettings({ mineruExecutable: event.target.value })} /></label><div className="settings-grid"><label>Reader font size<input type="range" min="14" max="25" value={settings.fontSize} onChange={event => updateSettings({ fontSize: Number(event.target.value) })} />{settings.fontSize}px</label><label>Line spacing<input type="range" min="1.3" max="2.2" step="0.1" value={settings.lineHeight} onChange={event => updateSettings({ lineHeight: Number(event.target.value) })} />{settings.lineHeight}</label><label>Reading width<input type="range" min="560" max="1100" step="20" value={settings.readingWidth} onChange={event => updateSettings({ readingWidth: Number(event.target.value) })} />{settings.readingWidth}px</label></div></>}
      {modal === 'settings' && <div className="hardware-panel">
        <div className="row"><strong>Graphics acceleration</strong><button className="button outline" onClick={() => { api.graphicsStatus().then(setHardware); api.mineruRuntime(settings.mineruExecutable).then(setMineruRuntime); api.runningModels(settings.ollamaBaseURL).then(setRunningModels).catch(() => setRunningModels([])); }}><RefreshCw size={14} /> Check</button></div>
        <p>{hardware?.adapters?.length ? hardware.adapters.map(adapter => `${adapter.name} (${adapter.vendor})`).join(' · ') : 'No graphics adapter reported by Windows.'}</p>
        <p>{hardware?.cudaDriver?.length ? `NVIDIA driver detected: ${hardware.cudaDriver.map(device => `${device.name}, ${device.memoryMiB || '?'} MiB`).join('; ')}.` : hardware?.adapters?.some(adapter => adapter.vendor === 'AMD') ? 'AMD detected. Ollama may use supported ROCm or Vulkan hardware.' : 'Ollama chooses its available CPU or GPU backend automatically.'}</p>
        <p>{mineruRuntime?.checked ? `MinerU Python: PyTorch ${mineruRuntime.torch}; CUDA ${mineruRuntime.cuda ? `available (${mineruRuntime.devices.join(', ')})` : 'unavailable'}.` : mineruRuntime?.reason || 'Checking MinerU Python environment…'}</p>
        {runningModels.length > 0 && <p>Ollama loaded: {runningModels.map(model => `${model.name} · ${(model.sizeVram / 1024 ** 3).toFixed(1)} GB VRAM`).join('; ')}</p>}
        <label>MinerU backend<select value={settings.mineruBackend || 'auto'} onChange={event => updateSettings({ mineruBackend: event.target.value })}><option value="auto">Auto (MinerU selects available acceleration)</option><option value="pipeline">Pipeline compatibility mode</option></select></label>
      </div>}
      {modal === 'glossary' && <><p>Approved terms guide future translations in the same language direction.</p>{glossary.map((term, index) => <div className="term-row" key={`${term.source}-${index}`}><span><b>{term.source}</b> → {term.target}<small>{term.sourceLanguage} → {term.targetLanguage}</small></span><button className="icon-button" onClick={() => setGlossary(current => current.filter((_, at) => at !== index))}><Trash2 size={16} /></button></div>)}{!glossary.length && <p>No saved terms yet. Select a phrase in Reader to add one.</p>}</>}
      {modal === 'library' && <><input placeholder="Search titles and tags" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} />{filteredLibrary.map(item => <button className="modal-list-row" key={item.id} onClick={() => { loadPaper(item.id).catch(err => setError(err.message)); setModal(''); }}><BookOpen size={17} /><span><b>{item.name}</b><small>{item.blockCount} blocks · {item.updatedAt?.slice(0, 10)}</small></span></button>)}{paper && <label>Tags for current paper<input value={(paper.tags || []).join(', ')} onChange={event => commitPaper(current => ({ ...current, tags: event.target.value.split(',').map(value => value.trim()).filter(Boolean) }))} /></label>}</>}
      {modal === 'more' && <div className="menu-list"><button onClick={() => setModal('range')}><Languages size={17} /> Translation Range</button><button onClick={() => { setModal(''); runMineru(); }} disabled={paper?.type !== 'pdf'}><FileText size={17} /> Parse with MinerU</button><button onClick={() => setModal('export')}><Download size={17} /> Export Markdown</button><button onClick={() => { setModal(''); setFocus(!focus); setInspector(focus); }}><Focus size={17} /> {focus ? 'Exit Focus Reading' : 'Focus Reading'}</button><button onClick={() => setModal('settings')}><Settings2 size={17} /> Settings</button></div>}
      {modal === 'range' && <div className="menu-list"><button onClick={() => { setModal(''); translateBlocks(abstractConclusionIds); }}>Abstract & Conclusion <small>{abstractConclusionIds.length} blocks</small></button><button onClick={() => { setModal(''); translateBlocks(currentSectionIds); }}>Current section <small>{currentSectionIds.length} blocks</small></button><button onClick={() => { setModal(''); translateBlocks(paper.blocks.map(block => block.id)); }}>All unfinished blocks <small>{paper.blocks.filter(block => block.status !== 'ok').length} blocks</small></button></div>}
      {modal === 'export' && <div className="menu-list">{[['original', 'Original Markdown'], ['translated', 'Translated Markdown'], ['bilingual', 'Bilingual Markdown'], ['analysis', 'Summary and notes']].map(([kind, label]) => <button key={kind} onClick={() => exportMarkdown(kind)}><Download size={17} /> {label}</button>)}</div>}
    </div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
