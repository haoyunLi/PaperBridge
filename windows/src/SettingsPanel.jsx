import React, { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, BookOpen, Cpu, Download, FileText, HardDrive, RefreshCw, Settings2, Square } from 'lucide-react';
import SettingsModels from './SettingsModels.jsx';
import './settings.css';

const api = window.paperBridge;
const sections = [
  ['setup', 'Local AI', Download], ['parsing', 'Parsing', FileText], ['models', 'Models', Cpu],
  ['reading', 'Reading', BookOpen], ['updates', 'Updates', RefreshCw], ['data', 'Local Data', HardDrive]
];

function Group({ title, children }) {
  return <section className="settings-section"><h3>{title}</h3>{children}</section>;
}

export default function SettingsPanel({ settings, onSettings, languages, busy, onOnboarding, onOpenSetup, onClearData,
  modelTools, hardwareTools, updates }) {
  const [section, setSection] = useState('setup');
  const [parserCheck, setParserCheck] = useState(0);
  const [parser, setParser] = useState(null);
  const [checkingParser, setCheckingParser] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [parserError, setParserError] = useState('');
  const mounted = useRef(true);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const { models, ollamaError, pulling, cancelling, progress, message, error, name, onName,
    onRefresh, onDownload, onCancel, onUse, onRecommendation } = modelTools;
  const { hardware, mineruRuntime, runningModels, checking, onCheck, error: hardwareError } = hardwareTools;
  const locked = Boolean(busy || pulling);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const pdfOnly = settings.pdfExtractionMode === 'pdfOnly';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (section !== 'parsing') return;
    let current = true;
    setCheckingParser(true); setParser(null); setParserError('');
    api.mineruStatus(settings.mineruExecutable).then(result => { if (current) setParser(result); })
      .catch(cause => { if (current) setParserError(cause.message); })
      .finally(() => { if (current) setCheckingParser(false); });
    return () => { current = false; };
  }, [section, settings.mineruExecutable, parserCheck]);

  async function detectMineru() {
    if (detecting || locked) return;
    const previousPath = settingsRef.current.mineruExecutable;
    setDetecting(true); setParserError('');
    try {
      const result = await api.detectMineru();
      if (!mounted.current || settingsRef.current.mineruExecutable !== previousPath) return;
      if (lockedRef.current) { setParserError('Another task started during detection. Finish that task, then use Auto-Detect again.'); return; }
      if (!result.compatible || !result.executable) throw new Error(result.reason || 'No compatible MinerU installation was found. Use Local AI setup to install it.');
      onSettings({ mineruExecutable: result.executable }); setParser(result);
    } catch (cause) { if (mounted.current) setParserError(cause.message); }
    finally { if (mounted.current) setDetecting(false); }
  }

  function chooseSection(value) {
    setSection(value);
    document.querySelector('.settings-content')?.scrollTo({ top: 0 });
  }
  function navigateTabs(event, index) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else return;
    event.preventDefault(); chooseSection(sections[next][0]); document.getElementById(`settings-tab-${sections[next][0]}`)?.focus();
  }

  return <div className="settings-panel">
    <nav className="settings-tabs" role="tablist" aria-label="Settings sections">{sections.map(([id, label, Icon], index) => <button
      key={id} id={`settings-tab-${id}`} role="tab" aria-controls={`settings-section-${id}`} aria-selected={section === id}
      tabIndex={section === id ? 0 : -1} onClick={() => chooseSection(id)} onKeyDown={event => navigateTabs(event, index)}><Icon size={16} />{label}</button>)}</nav>
    {(pulling || message || error) && <div className="settings-download-status" role={error ? 'alert' : 'status'}>
      <div><strong>{pulling ? progress?.status || 'Preparing model download…' : error || message}</strong>
        {pulling && Number(progress?.total) > 0 && <progress aria-label="Model download progress" value={progress.completed || 0} max={progress.total} />}</div>
      {pulling && <button className="button outline" disabled={cancelling} onClick={onCancel}><Square size={14} />{cancelling ? 'Cancelling…' : 'Cancel download'}</button>}
    </div>}
    <div className="settings-content" role="tabpanel" id={`settings-section-${section}`} aria-labelledby={`settings-tab-${section}`}>
      {section === 'setup' && <>
        <Group title="Set up local AI"><p>Detect this PC's local tools, install the components you choose, or follow the Getting Started guide.</p>
          <div className="row"><button className="button outline" disabled={locked} onClick={onOnboarding}>Getting Started guide</button><button className="button blue" disabled={locked} onClick={onOpenSetup}><Download size={16} />Detect and install local AI</button></div>
          {ollamaError && <p className="settings-error">{ollamaError} Start Ollama or use local AI setup before downloading.</p>}
        </Group>
        <SettingsModels settings={settings} models={models} hardware={hardware} busy={locked || Boolean(ollamaError)} pullProgress={progress} onUse={onUse} onDownload={onRecommendation} />
      </>}
      {section === 'parsing' && <>
        <Group title="PDF parsing"><div className="settings-status-row"><div><strong>{checkingParser ? 'Checking MinerU…' : parser?.compatible ? 'MinerU is ready' : 'MinerU is unavailable'}</strong>
          <p>{parser?.compatible ? `${parser.version} · ${parser.executable}` : parser?.reason || 'Check a local installation or use automatic discovery.'}</p></div>
          <button className="button outline" disabled={checkingParser || detecting} onClick={() => setParserCheck(value => value + 1)}>Check again</button></div>
          <fieldset disabled={locked || detecting}>
            <label>PDF extraction mode<select value={settings.pdfExtractionMode || 'mineruPreferred'} onChange={event => onSettings({ pdfExtractionMode: event.target.value })}><option value="mineruPreferred">MinerU, then selectable PDF text</option><option value="mineruOnly">MinerU only</option><option value="pdfOnly">Selectable PDF text only (no OCR)</option></select></label>
            <p>{pdfOnly ? 'Uses the existing text layer without installing tools or running OCR.' : settings.pdfExtractionMode === 'mineruOnly' ? 'Requires compatible MinerU. If parsing fails, the original PDF remains available.' : 'Tries structured MinerU extraction first; if it fails, uses the PDF text layer.'}</p>
            <label>MinerU backend<select disabled={pdfOnly} value={settings.mineruBackend || 'auto'} onChange={event => onSettings({ mineruBackend: event.target.value })}><option value="auto">Auto (MinerU selects available acceleration)</option><option value="pipeline">Pipeline compatibility mode</option></select></label>
            <label>MinerU executable<input disabled={pdfOnly} value={settings.mineruExecutable} placeholder="Auto-detect when empty" onChange={event => onSettings({ mineruExecutable: event.target.value })} /></label>
            <button className="button outline" disabled={pdfOnly || checkingParser} onClick={detectMineru}>{detecting ? 'Detecting…' : 'Use Auto-Detect'}</button>
          </fieldset>
          {parserError && <p className="settings-error" role="alert">{parserError}</p>}
        </Group>
        <Group title="Original PDF · no OCR"><p>The original-page viewer keeps the PDF layout, figures and formulas. Existing selectable text can be translated without MinerU. Image-only pages need OCR before translation or summary.</p></Group>
        <Group title="What MinerU adds"><p>Structured reading order, headings, images, captions, tables and LaTeX formulas. MinerU is optional; its output and the original PDF remain stored locally.</p></Group>
      </>}
      {section === 'models' && <>
        <Group title="Ollama"><fieldset disabled={locked}><label>Ollama URL<input value={settings.ollamaBaseURL} onChange={event => onSettings({ ollamaBaseURL: event.target.value })} /></label><button className="button outline" onClick={onRefresh}><RefreshCw size={15} />Refresh models</button></fieldset>{ollamaError && <p className="settings-error" role="alert">{ollamaError}</p>}</Group>
        <Group title="Task models"><fieldset disabled={locked}><div className="settings-grid">{[['translationModel', 'Translation model'], ['summaryModel', 'Summary model'], ['explainModel', 'Explanation model'], ['quickLookupModel', 'Quick lookup model']].map(([key, label]) => <label key={key}>{label}<select value={settings[key] || settings.translationModel} onChange={event => onSettings({ [key]: event.target.value })}>{[...new Set([settings[key] || settings.translationModel, ...models])].map(value => <option key={value}>{value}</option>)}</select></label>)}</div></fieldset><p>Quick lookup handles selected-text translation and explanation. A smaller model can respond sooner.</p></Group>
        <Group title="Download another model"><p>Enter an Ollama model name, or browse the recommendations in Local AI.</p><div className="row"><input aria-label="Model to download" value={name} disabled={locked} placeholder="translategemma:4b" onChange={event => onName(event.target.value)} /><button className="button blue" disabled={locked} onClick={() => onDownload()}>Download model</button></div></Group>
        <Group title="Graphics acceleration"><div className="settings-status-row"><p>{hardware?.adapters?.length ? hardware.adapters.map(adapter => `${adapter.name} (${adapter.vendor})`).join(' · ') : 'No graphics adapter reported by Windows.'}</p><button className="button outline" disabled={checking} onClick={onCheck}><RefreshCw size={14} />{checking ? 'Checking…' : 'Check'}</button></div>
          <p>{hardware?.cudaDriver?.length ? `NVIDIA driver detected: ${hardware.cudaDriver.map(device => `${device.name}, ${device.memoryMiB || '?'} MiB`).join('; ')}.` : hardware?.adapters?.some(adapter => adapter.vendor === 'AMD') ? 'AMD detected. Ollama may use supported ROCm or Vulkan hardware.' : 'Ollama chooses its available CPU or GPU backend automatically.'}</p>
          <p>{mineruRuntime?.checked ? `MinerU Python: PyTorch ${mineruRuntime.torch}; CUDA ${mineruRuntime.cuda ? `available (${mineruRuntime.devices.join(', ')})` : 'unavailable'}.` : mineruRuntime?.reason || 'Check the MinerU Python environment to see its acceleration status.'}</p>
          {runningModels.length > 0 && <p>Ollama loaded: {runningModels.map(model => `${model.name} · ${(model.sizeVram / 1024 ** 3).toFixed(1)} GB VRAM`).join('; ')}</p>}
          {hardwareError && <p className="settings-error" role="alert">{hardwareError}</p>}
        </Group>
      </>}
      {section === 'reading' && <fieldset disabled={locked}>
        <Group title="Translation direction"><div className="settings-grid"><label>Source language<select value={settings.sourceLanguage} onChange={event => onSettings({ sourceLanguage: event.target.value })}>{languages.map(value => <option key={value}>{value}</option>)}</select></label><label>Target language<select value={settings.targetLanguage} onChange={event => onSettings({ targetLanguage: event.target.value })}>{languages.map(value => <option key={value}>{value}</option>)}</select></label></div><button className="button ghost" onClick={() => onSettings({ sourceLanguage: settings.targetLanguage, targetLanguage: settings.sourceLanguage })}><ArrowRightLeft size={15} />Swap languages</button></Group>
        <Group title="Translation chunking"><label>Maximum translation chunk<input type="range" min="500" max="6000" step="100" value={settings.maxParagraphChars} onChange={event => onSettings({ maxParagraphChars: Number(event.target.value) })} />{settings.maxParagraphChars} characters</label><p>Sets the maximum size of each translation request. Reader paragraphs remain visually intact.</p></Group>
        <Group title="Reading appearance"><div className="settings-grid"><label>Reader font size<input type="range" min="14" max="25" value={settings.fontSize} onChange={event => onSettings({ fontSize: Number(event.target.value) })} />{settings.fontSize}px</label><label>Line spacing<input type="range" min="1.3" max="2.2" step="0.1" value={settings.lineHeight} onChange={event => onSettings({ lineHeight: Number(event.target.value) })} />{settings.lineHeight}</label><label>Reading width<input type="range" min="560" max="1100" step="20" value={settings.readingWidth} onChange={event => onSettings({ readingWidth: Number(event.target.value) })} />{settings.readingWidth}px</label></div></Group>
      </fieldset>}
      {section === 'updates' && <Group title={`Windows updates · ${updates.version || 'unknown version'}`}><button className="button outline" disabled={updates.checking} onClick={updates.onCheck}><RefreshCw size={14} />Check now</button><label className="settings-checkbox"><input type="checkbox" checked={settings.autoCheckUpdates !== false} onChange={event => onSettings({ autoCheckUpdates: event.target.checked })} />Check official Windows releases at most once per day</label>{updates.status && <p role="status">{updates.status}</p>}<p>New versions open on the official GitHub release page. This unsigned preview does not install updates automatically.</p></Group>}
      {section === 'data' && <><Group title="Local workspace"><p>Papers, translations, notes, bookmarks, terminology and settings are saved in this Windows account. Removing saved data keeps original PDF copies.</p><button className="button danger" disabled={locked} onClick={onClearData}>Remove all saved PaperBridge data…</button></Group><Group title="Privacy"><p>Paper text and model requests stay on this PC. Downloads and update checks use the network. No cloud account is required.</p></Group></>}
    </div>
  </div>;
}
