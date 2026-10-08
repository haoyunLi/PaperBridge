import React, { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Download, Square } from 'lucide-react';

const api = window.paperBridge;
const allComponents = { ollama: true, models: true, mineru: true };
const formatBytes = value => value ? `${(value / 1024 ** 2).toFixed(0)} MB` : '';

export default function SetupPanel({ settings, progress, onSettings, onInstalled }) {
  const [diagnosis, setDiagnosis] = useState(null);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [components, setComponents] = useState({ ...allComponents, ...settings.setupComponents });
  const request = useRef(0);
  const action = useRef(false);
  const mounted = useRef(true);
  const config = (selected = components) => ({
    baseURL: settings.ollamaBaseURL, mineruExecutable: settings.mineruExecutable, components: selected,
    models: [...new Set([settings.translationModel, settings.summaryModel, settings.explainModel, settings.quickLookupModel || settings.translationModel])]
  });

  async function refresh(selected = components) {
    const id = ++request.current;
    setChecking(true);
    try {
      const result = await api.setupStatus(config(selected));
      if (!mounted.current || id !== request.current) return;
      setDiagnosis(result); setWorking(result.busy); setResumed(result.busy); setError('');
    } catch (cause) { if (mounted.current && id === request.current) setError(cause.message); }
    finally { if (mounted.current && id === request.current) setChecking(false); }
  }

  useEffect(() => { mounted.current = true; refresh(); return () => { mounted.current = false; request.current++; }; }, []);
  useEffect(() => {
    if (!resumed || !['done', 'error', 'cancelled'].includes(progress?.phase)) return;
    refresh();
  }, [resumed, progress?.phase]);

  function chooseComponent(key, checked) {
    const selected = { ...components, [key]: checked };
    setComponents(selected); onSettings({ setupComponents: selected }); refresh(selected);
  }

  async function install(repairMineru = false) {
    if (action.current || working) return;
    action.current = true;
    request.current++; setChecking(false); setWorking(true); setResumed(false); setError(''); setWarning('');
    const options = repairMineru ? { ...config({ ollama: false, models: false, mineru: true }), repairMineru: true } : config();
    try {
      const result = await api.setupInstall(options);
      const change = {};
      if (typeof result.mineruExecutable === 'string') change.mineruExecutable = result.mineruExecutable;
      if (typeof result.mineruBackend === 'string') change.mineruBackend = result.mineruBackend;
      if (Object.keys(change).length) onSettings(change);
      await onInstalled();
      if (mounted.current) {
        setWarning(result.warning || 'Installation complete. PaperBridge will use the detected local tools.');
        const refreshed = await api.setupStatus({ ...config(), ...change });
        if (mounted.current) setDiagnosis(refreshed);
      }
    } catch (cause) {
      if (mounted.current) { await refresh(); if (mounted.current) setError(cause.message); }
    } finally { action.current = false; if (mounted.current) setWorking(false); }
  }

  const selected = Object.values(components).some(Boolean);
  const missing = diagnosis && selected && (diagnosis.plan.ollama || diagnosis.plan.models.length || diagnosis.plan.mineru);
  const gpu = diagnosis?.plan.gpu;
  const mineru = diagnosis?.mineru;
  const activeProgress = progress || diagnosis?.progress;
  const ollamaSelected = components.ollama || components.models;
  return <div className="setup-panel">
    <p>Choose the local tools you need. PaperBridge checks this PC and installs missing components in your Windows account. MinerU is optional and can require several gigabytes.</p>
    <fieldset className="setup-components" disabled={working}>
      <legend>Components to install</legend>
      <label><input type="checkbox" checked={components.ollama} onChange={event => chooseComponent('ollama', event.target.checked)} /> Ollama runtime</label>
      <label><input type="checkbox" checked={components.models} onChange={event => chooseComponent('models', event.target.checked)} /> Selected AI models</label>
      <label><input type="checkbox" checked={components.mineru} onChange={event => chooseComponent('mineru', event.target.checked)} /> MinerU PDF parser (optional)</label>
      {components.models && !components.ollama && <small>Selected models require Ollama. Setup will start or install the runtime if needed.</small>}
    </fieldset>
    <div className="setup-heading"><strong>Detected environment</strong><button className="button outline" disabled={checking || working} onClick={() => refresh()}><RefreshCw size={14} /> {checking ? 'Checking…' : 'Check again'}</button></div>
    {checking && !diagnosis && <p>Checking Ollama, models, MinerU, and graphics hardware…</p>}
    {diagnosis && <>
      <div className="setup-row"><span className={diagnosis.ollama.running ? 'setup-ok' : 'setup-needed'}>{diagnosis.ollama.running ? <Check size={16} /> : <Download size={16} />}</span><div><strong>Ollama</strong><small>{!ollamaSelected ? 'Not selected for installation' : diagnosis.ollama.running ? 'Local API is ready' : diagnosis.ollama.installed ? 'Installed; PaperBridge can start it' : 'Not installed; official signed installer will be downloaded'}</small></div></div>
      <div className="setup-row"><span className={diagnosis.plan.models.length ? 'setup-needed' : 'setup-ok'}>{diagnosis.plan.models.length ? <Download size={16} /> : <Check size={16} />}</span><div><strong>Local models</strong><small>{!components.models ? 'Not selected for installation' : diagnosis.plan.models.length ? `To download: ${diagnosis.plan.models.join(', ')}` : `Ready: ${config().models.join(', ')}`}</small></div></div>
      <div className="setup-row"><span className={diagnosis.plan.mineru ? 'setup-needed' : 'setup-ok'}>{diagnosis.plan.mineru ? <Download size={16} /> : <Check size={16} />}</span><div><strong>MinerU structured PDF parser</strong><small>{!components.mineru ? 'Not selected; original PDFs and selectable-text reading remain available' : diagnosis.plan.mineru ? mineru?.compatible ? `Installed, but CUDA is not ready${mineru.runtime?.reason ? `: ${mineru.runtime.reason}` : ''}. Setup can create a private managed environment.` : mineru?.installed ? 'Existing command is not compatible with this reader; install a private compatible copy' : 'Not installed; an isolated Python and MinerU will be installed' : `${mineru.version}${mineru.runtime?.cuda ? ' · PyTorch CUDA ready' : ' · CPU pipeline available'}`}</small></div></div>
      <div className="setup-hardware"><strong>Graphics acceleration</strong><p>{diagnosis.hardware.adapters?.length ? diagnosis.hardware.adapters.map(adapter => `${adapter.name} (${adapter.vendor})`).join(' · ') : 'Windows did not report a graphics adapter.'}</p><p>{gpu.reason}</p><p>Ollama chooses its supported NVIDIA, AMD, Vulkan, or CPU backend automatically. MinerU CUDA is verified in its own Python environment after installation.</p></div>
    </>}
    {working && activeProgress && <div className="setup-progress"><strong>{activeProgress.message}</strong>{activeProgress.received > 0 && <small>{formatBytes(activeProgress.received)}{activeProgress.total ? ` / ${formatBytes(activeProgress.total)}` : ''}</small>}{activeProgress.total > 0 && <progress value={activeProgress.received} max={activeProgress.total} />}</div>}
    {error && <p className="setup-error" role="alert">{error}</p>}
    {warning && <p className="setup-success" role="status">{warning}</p>}
    <div className="setup-actions">{working ? <button className="button danger" onClick={() => api.setupCancel().catch(cause => setError(cause.message))}><Square size={14} /> Cancel setup</button> : <><button className="button blue" disabled={checking || !missing} onClick={() => install()}><Download size={16} /> {!selected ? 'Select components' : missing ? 'Install missing components' : 'Selected components are ready'}</button>{mineru?.installed && <button className="button outline" disabled={checking} onClick={() => install(true)}><RefreshCw size={14} /> Repair / update MinerU</button>}</>}</div>
    {mineru?.installed && <p className="setup-footnote">Repair installs the MinerU version supported by this app into its private environment. It can download several gigabytes; the previous managed version is restored if activation fails.</p>}
    <p className="setup-footnote">Working components are retained. GPU drivers are managed by Windows and your graphics vendor.</p>
  </div>;
}
