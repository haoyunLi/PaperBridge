import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, Download, FileText, HardDrive, Languages, LockKeyhole, RefreshCw, Settings2, Sparkles, Square } from 'lucide-react';
import { TRANSLATION_MODELS, ASSISTANT_MODELS, MODEL_CATALOG_VERIFIED_AT, modelSettingsPatch, isCatalogModelSelected, suggestedTranslationModel } from './modelCatalog.mjs';
import './onboarding.css';

const api = window.paperBridge;
const emptyModels = [];
const steps = [
  { title: 'Welcome', icon: BookOpen }, { title: 'Ollama', icon: HardDrive },
  { title: 'Translation model', icon: Languages }, { title: 'MinerU parser', icon: FileText },
  { title: 'Explanation model', icon: Sparkles }, { title: 'Ready', icon: Check }
];
const terminal = phase => ['done', 'error', 'cancelled'].includes(phase);
const progressBytes = value => `${(Number(value || 0) / 1024 ** 2).toFixed(0)} MB`;
const setupIdentity = (baseURL, mineruExecutable) => JSON.stringify([baseURL || '', mineruExecutable || '']);

function Heading({ eyebrow, title, children }) {
  return <header className="onboarding-heading"><small>{eyebrow}</small><h2 id="onboarding-page-title">{title}</h2><p>{children}</p></header>;
}

function Callout({ title, children }) {
  return <div className="onboarding-callout"><strong>{title}</strong><p>{children}</p></div>;
}

function ReadinessRow({ title, detail, ready, optional }) {
  return <div className={`onboarding-readiness ${ready ? 'ready' : ''}`}><span aria-hidden="true">{ready ? <Check size={18} /> : optional ? '—' : '!'}</span><div><strong>{title} {optional && <small>Optional</small>}</strong><p>{detail}</p></div></div>;
}

function ModelCard({ model, installed, selected, active, disabled, onAction }) {
  return <article className={`onboarding-model-card ${selected ? 'selected' : ''}`} data-model-id={model.id}>
    <div className="onboarding-model-copy"><div className="onboarding-model-title"><h3>{model.title}</h3><span>{model.badge}</span>{installed && <b><Check size={12} /> Installed</b>}</div>
      <code>{model.id}</code><p>{model.detail}</p><small>{model.guidance}</small>
      <div className="onboarding-model-meta"><span>About {model.downloadGB.toFixed(1)} GB download</span><a href={model.url} target="_blank" rel="noreferrer">Official model details</a></div>
    </div>
    <button className={`button ${selected ? 'outline' : 'blue'}`} disabled={disabled || selected || active} onClick={onAction}>
      {selected ? <Check size={14} /> : <Download size={14} />}{active ? 'Downloading…' : selected ? 'Selected' : installed ? 'Use model' : 'Download & use'}
    </button>
  </article>;
}

export default function Onboarding({ settings, onSettings, onFinish, onOpenSetup, progress, pullProgress, models = emptyModels, onModelsChanged, onBusyChange }) {
  const identity = setupIdentity(settings.ollamaBaseURL, settings.mineruExecutable);
  const [diagnosisState, setDiagnosis] = useState(null);
  const [modelState, setKnownModels] = useState({ identity, values: models });
  const diagnosis = diagnosisState?.identity === identity ? diagnosisState.value : null;
  const knownModels = modelState.identity === identity ? modelState.values : emptyModels;
  const [checking, setChecking] = useState(false);
  const [operation, setOperation] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const settingsRef = useRef(settings);
  const mounted = useRef(true);
  const ownOperation = useRef(false);
  const refreshVersion = useRef(0);
  const previousPhases = useRef({ setup: progress?.phase, model: pullProgress?.phase });
  const scrollHost = useRef(null);
  settingsRef.current = settings;
  const page = Math.max(0, Math.min(5, Number.isInteger(settings.onboardingPage) ? settings.onboardingPage : 0));
  const externalPull = pullProgress?.phase === 'pulling';
  const busy = Boolean(operation || diagnosis?.busy || externalPull);
  const ollamaReady = diagnosis?.ollama?.running === true;
  const mineruReady = diagnosis?.mineru?.compatible === true;
  const modelProgress = operation?.kind !== 'model' || pullProgress?.model === operation.id ? pullProgress : null;
  const candidateProgress = operation?.kind === 'model' || externalPull ? modelProgress : progress;
  const currentProgress = terminal(candidateProgress?.phase) ? null : candidateProgress;
  const suggested = suggestedTranslationModel(diagnosis?.hardware);
  const systemMemoryGiB = Number(diagnosis?.hardware?.systemMemoryBytes) / 1024 ** 3;
  const selectedTranslationReady = knownModels.includes(settings.translationModel);
  const assistantReady = ['summaryModel', 'explainModel', 'quickLookupModel'].every(key => knownModels.includes(settings[key]));

  function config(overrides = {}) {
    const current = settingsRef.current;
    return { baseURL: current.ollamaBaseURL, mineruExecutable: current.mineruExecutable,
      models: [...new Set([current.translationModel, current.summaryModel, current.explainModel, current.quickLookupModel].filter(Boolean))], ...overrides };
  }

  async function refresh(overrides) {
    const version = ++refreshVersion.current;
    const request = config(overrides);
    const requestIdentity = setupIdentity(request.baseURL, request.mineruExecutable);
    const isCurrent = () => mounted.current && version === refreshVersion.current
      && requestIdentity === setupIdentity(settingsRef.current.ollamaBaseURL, settingsRef.current.mineruExecutable);
    if (mounted.current) setChecking(true);
    try {
      const result = await api.setupStatus(request);
      if (isCurrent()) {
        setDiagnosis({ identity: requestIdentity, value: result });
        setKnownModels({ identity: requestIdentity, values: result.ollama?.models || [] });
      }
      return result;
    } catch (cause) {
      if (isCurrent()) setError(cause.message);
      return null;
    } finally { if (isCurrent()) setChecking(false); }
  }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; refreshVersion.current++; }; }, []);
  useEffect(() => {
    setDiagnosis(null); setError(''); refresh();
    return () => { refreshVersion.current++; };
  }, [identity]);
  useEffect(() => { setKnownModels({ identity, values: models }); }, [models]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const changed = previousPhases.current.setup !== progress?.phase && terminal(progress?.phase)
      || previousPhases.current.model !== pullProgress?.phase && terminal(pullProgress?.phase);
    previousPhases.current = { setup: progress?.phase, model: pullProgress?.phase };
    if (!ownOperation.current && changed) {
      setCancelling(false); refresh();
    }
  }, [progress?.phase, pullProgress?.phase]);
  useEffect(() => { if (scrollHost.current) scrollHost.current.scrollTop = 0; }, [page]);

  function changePage(value) {
    if (busy || ownOperation.current) return;
    setError(''); setMessage(''); onSettings({ onboardingPage: Math.max(0, Math.min(5, value)) });
  }

  async function installComponent(kind, repairMineru = false) {
    if (busy || ownOperation.current) return;
    ownOperation.current = true; setOperation({ kind }); onBusyChange?.(true); setError(''); setMessage(''); setCancelling(false);
    try {
      const result = await api.setupInstall(config({ components: { ollama: kind === 'ollama', models: false, mineru: kind === 'mineru' }, repairMineru }));
      const patch = {};
      if (kind === 'mineru' && result.mineruExecutable) patch.mineruExecutable = result.mineruExecutable;
      if (kind === 'mineru' && result.mineruBackend) patch.mineruBackend = result.mineruBackend;
      if (Object.keys(patch).length) onSettings(patch);
      await onModelsChanged?.();
      await refresh(patch.mineruExecutable ? { mineruExecutable: patch.mineruExecutable } : {});
      if (mounted.current) setMessage(result.warning || `${kind === 'ollama' ? 'Ollama' : 'MinerU'} setup completed.`);
    } catch (cause) {
      await refresh();
      if (mounted.current) setError(cause.message);
    } finally {
      ownOperation.current = false;
      if (mounted.current) { setOperation(null); setCancelling(false); }
    }
  }

  function useModel(model, available = knownModels) {
    onSettings(modelSettingsPatch(settingsRef.current, model, available));
    setMessage(model.role === 'translation' ? `${model.title} is selected for translation. Following assistant roles use it too.` : `${model.title} is selected for Summary, Explain, and quick lookup.`);
  }

  async function downloadOrUse(model) {
    if (busy || ownOperation.current) return;
    setError(''); setMessage('');
    if (knownModels.includes(model.id)) { useModel(model); return; }
    if (!ollamaReady) { setError('Start Ollama before downloading a model.'); return; }
    ownOperation.current = true; setOperation({ kind: 'model', id: model.id }); onBusyChange?.(true); setCancelling(false);
    try {
      await api.pullModel({ baseURL: settingsRef.current.ollamaBaseURL, model: model.id });
      const available = await api.listModels(settingsRef.current.ollamaBaseURL);
      if (!available.includes(model.id)) throw new Error('The download finished, but Ollama has not listed the model yet. Refresh to check before selecting it.');
      if (mounted.current) { setKnownModels({ identity, values: available }); useModel(model, available); }
      await onModelsChanged?.();
    } catch (cause) { if (mounted.current) setError(cause.message); }
    finally { ownOperation.current = false; if (mounted.current) { setOperation(null); setCancelling(false); } }
  }

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      if (operation?.kind === 'model' || externalPull) await api.cancelPullModel();
      else await api.setupCancel();
    } catch (cause) { setError(cause.message); setCancelling(false); }
  }

  const renderModels = items => <div className="onboarding-models">{items.map(model => <ModelCard key={model.id} model={model}
    installed={knownModels.includes(model.id)} selected={isCatalogModelSelected(settings, model, knownModels)}
    active={operation?.id === model.id || (externalPull && pullProgress.model === model.id)}
    disabled={busy || checking || (!ollamaReady && !knownModels.includes(model.id))} onAction={() => downloadOrUse(model)} />)}</div>;

  return <section className="onboarding" aria-labelledby="onboarding-page-title" data-onboarding-page={page}>
    <aside className="onboarding-rail"><div className="onboarding-brand"><img src="./brand.png" alt="" /><div><strong>PaperBridge</strong><span>Getting started</span></div></div>
      <ol>{steps.map((step, index) => { const Icon = step.icon; return <li key={step.title} className={index === page ? 'current' : index < page ? 'visited' : ''} aria-current={index === page ? 'step' : undefined}><span>{index < page ? <Check size={16} /> : <Icon size={16} />}</span><b>{step.title}</b></li>; })}</ol>
      <p className="onboarding-private"><LockKeyhole size={15} /> Documents stay on this PC</p>
    </aside>
    <div className="onboarding-main"><div className="onboarding-content" ref={scrollHost}>
      <div className="onboarding-topline"><span>Step {page + 1} of {steps.length}</span><button className="button ghost" disabled={checking || busy} onClick={() => { setError(''); refresh(); }}><RefreshCw size={14} />{checking ? 'Checking…' : 'Refresh status'}</button></div>
      {page === 0 && <><Heading eyebrow="WELCOME TO PAPERBRIDGE" title="Build your local reading setup.">Set up local AI and structured PDF reading in six steps. Each download starts only when you choose it.</Heading>
        <div className="onboarding-welcome-grid">{[
          ['01', 'Ollama runtime', 'Runs language models locally and provides the local API used by PaperBridge.'],
          ['02', 'TranslateGemma', 'Choose the 4B, 12B, or 27B translation model to suit your computer.'],
          ['03', 'MinerU parser', 'Optional structured extraction for reading order, figures, tables, formulas, and OCR.'],
          ['04', 'Explanation model', 'An optional assistant for summaries, explanations, and selected-text lookup.']
        ].map(([number, title, detail]) => <article key={number}><small>{number}</small><h3>{title}</h3><p>{detail}</p></article>)}</div>
        <Callout title="Local after setup">Internet is used for tool/model downloads and update checks. Paper text, notes, translations, summaries, and explanations stay on this PC. You can open and read a PDF before installing AI tools.</Callout></>}
      {page === 1 && <><Heading eyebrow="REQUIRED FOR LOCAL AI" title="Start with Ollama.">Install the official signed Windows runtime or start the copy already on this PC.</Heading>
        <div className="onboarding-tool-card"><ReadinessRow title={ollamaReady ? 'Ollama is ready' : diagnosis?.ollama?.installed ? 'Ollama is installed' : 'Ollama runtime'} ready={ollamaReady} detail={ollamaReady ? 'Connected to the local API.' : diagnosis?.ollama?.installed ? 'Start the existing installation to use local AI.' : 'The official Windows installer will be downloaded when you click Install.'} />
          {!ollamaReady && <button className="button blue" disabled={busy || checking || !diagnosis} onClick={() => installComponent('ollama')}><Download size={15} />{diagnosis?.ollama?.installed ? 'Start Ollama' : 'Install Ollama'}</button>}
          <a href="https://ollama.com/download/windows" target="_blank" rel="noreferrer">Official Windows download</a>
        </div><Callout title="Already installed?">Start Ollama, then refresh this page. PaperBridge connects only to localhost, 127.0.0.1, or ::1. GPU drivers remain managed by Windows and your graphics vendor.</Callout></>}
      {page === 2 && <><Heading eyebrow="TRANSLATION MODEL" title="Choose a TranslateGemma size.">Select an installed model or download one. Choosing a translation model also updates assistant roles that followed the previous translation model.</Heading>
        <div className="onboarding-memory"><strong>{Number.isFinite(systemMemoryGiB) && systemMemoryGiB > 0 ? `This PC: ${Math.round(systemMemoryGiB)} GiB system RAM` : 'System memory is not available'}</strong><span>Starting suggestion: {suggested.title}</span><p>This RAM-based suggestion is a starting point. Downloads need additional runtime and context memory; system RAM is separate from GPU VRAM. Ollama decides how much can run on the GPU.</p></div>
        {renderModels(TRANSLATION_MODELS)}<p className="onboarding-footnote">Approximate download sizes checked {MODEL_CATALOG_VERIFIED_AT}; shared model files can reduce a download. Start Ollama before downloading. You can choose another model later.</p></>}
      {page === 3 && <><Heading eyebrow="OPTIONAL · STRUCTURED PDF READING" title="Turn PDFs into structured papers.">MinerU extracts reading order, figures, tables, formulas and text from image-only pages. The original PDF remains available.</Heading>
        <Callout title="Recommended for academic papers">Structured extraction helps with multi-column layouts and bilingual exports. Extraction quality still depends on the source PDF, especially for scanned equations and low-resolution pages.</Callout>
        <div className="onboarding-tool-card"><ReadinessRow title="MinerU parser" optional ready={mineruReady} detail={mineruReady ? `${diagnosis.mineru.version || 'Compatible MinerU'} · ${diagnosis.mineru.runtime?.cuda ? 'CUDA verified in its Python environment' : 'CPU pipeline available'}` : 'A private Python environment, MinerU and parsing models can require several gigabytes.'} />
          <button className="button blue" disabled={busy || checking || !diagnosis} onClick={() => installComponent('mineru', Boolean(diagnosis?.mineru?.installed))}><Download size={15} />{diagnosis?.mineru?.installed ? 'Repair / update MinerU' : 'Install MinerU'}</button>
        </div>{diagnosis?.plan?.gpu?.reason && <p className="onboarding-hardware">{diagnosis.plan.gpu.reason}</p>}<Callout title="Safe to skip">PDF text extraction and the original-page viewer work without MinerU. Image-only PDFs need OCR before translation. You can install MinerU from Local AI setup later.</Callout></>}
      {page === 4 && <><Heading eyebrow="OPTIONAL AI ENHANCEMENT" title="Choose an explanation model.">An assistant model is optional. Use it for Summary, Explain, and quick lookup while keeping TranslateGemma assigned to translation.</Heading>
        {renderModels(ASSISTANT_MODELS)}<Callout title="Use your translation model instead">Skipping this download keeps your current assistant selections. When a translation model is selected, missing assistant roles automatically follow it.</Callout></>}
      {page === 5 && <><Heading eyebrow="SETUP SUMMARY" title={ollamaReady && selectedTranslationReady ? 'Your local reader is ready.' : 'PDF reading is ready. AI setup is incomplete.'}>You can reopen Getting Started or change local tools and model roles in Settings at any time.</Heading>
        <div className="onboarding-tool-card"><ReadinessRow title="Ollama runtime" ready={ollamaReady} detail={ollamaReady ? 'Connected to the local API.' : 'Not connected; AI tasks need Ollama to be running.'} />
          <ReadinessRow title="Translation model" ready={selectedTranslationReady} detail={selectedTranslationReady ? settings.translationModel : `${settings.translationModel} is selected but has not been downloaded.`} />
          <ReadinessRow title="MinerU parser" optional ready={mineruReady} detail={mineruReady ? 'Structured PDF parsing is available.' : 'PDF text extraction remains available. Install MinerU when you need OCR or structured parsing.'} />
          <ReadinessRow title="Assistant models" optional ready={assistantReady} detail={`Summary: ${settings.summaryModel} · Explain: ${settings.explainModel} · Quick lookup: ${settings.quickLookupModel || settings.translationModel}`} />
        </div><div className="onboarding-ready-actions"><button className="button outline" disabled={busy} onClick={() => onFinish('practice')}><BookOpen size={16} /> Try a Practice Paper</button><button className="button ghost" disabled={busy} onClick={() => onFinish('done')}>Finish without opening a PDF</button></div></>}
      {busy && <div className="onboarding-progress" role="status"><strong>{currentProgress?.message || currentProgress?.status || (operation?.kind === 'model' ? `Downloading ${operation.id}…` : 'Local setup is running…')}</strong>
        {Number(currentProgress?.total) > 0 ? <><progress value={Number(currentProgress.received ?? currentProgress.completed ?? 0)} max={Number(currentProgress.total)} /><small>{progressBytes(currentProgress.received ?? currentProgress.completed)} / {progressBytes(currentProgress.total)}</small></> : <progress aria-label="Setup in progress" />}
        <button className="button danger" disabled={cancelling} onClick={cancel}><Square size={13} />{cancelling ? 'Cancelling…' : operation?.kind === 'model' || externalPull ? 'Cancel download' : 'Cancel setup'}</button>
      </div>}
      {error && <p className="onboarding-error" role="alert">{error}</p>}{message && <p className="onboarding-message" role="status">{message}</p>}
    </div><footer className="onboarding-footer"><button className="button ghost" disabled={busy} onClick={() => onFinish('skip')}>Skip setup</button><button className="button ghost onboarding-advanced" disabled={busy} onClick={onOpenSetup}><Settings2 size={14} />Advanced setup</button><span />{page > 0 && <button className="button outline" disabled={busy} onClick={() => changePage(page - 1)}>Back</button>}<button className="button blue" disabled={busy} onClick={() => page === 5 ? onFinish('openPdf') : changePage(page + 1)}>{page === 5 ? 'Finish & Open PDF' : 'Continue'}<ArrowRight size={15} /></button></footer></div>
  </section>;
}
