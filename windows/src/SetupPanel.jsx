import React, { useEffect, useState } from 'react';
import { Check, RefreshCw, Download, Square } from 'lucide-react';

const api = window.paperBridge;

function formatBytes(value) {
  if (!value) return '';
  return `${(value / 1024 ** 2).toFixed(0)} MB`;
}

export default function SetupPanel({ settings, progress, onSettings, onInstalled }) {
  const [diagnosis, setDiagnosis] = useState(null);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const config = () => ({
    baseURL: settings.ollamaBaseURL,
    mineruExecutable: settings.mineruExecutable,
    models: [...new Set([settings.translationModel, settings.summaryModel, settings.explainModel])]
  });

  async function refresh() {
    setChecking(true);
    try {
      const result = await api.setupStatus(config());
      setDiagnosis(result);
      setWorking(result.busy);
      setResumed(result.busy);
      setError('');
    }
    catch (cause) { setError(cause.message); }
    finally { setChecking(false); }
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!resumed || !['done', 'error', 'cancelled'].includes(progress?.phase)) return;
    const timer = setTimeout(() => { setResumed(false); refresh(); }, 200);
    return () => clearTimeout(timer);
  }, [resumed, progress?.phase]);

  async function install() {
    setWorking(true); setResumed(false); setError(''); setWarning('');
    try {
      const result = await api.setupInstall(config());
      onSettings({ mineruExecutable: result.mineruExecutable, mineruBackend: result.mineruBackend });
      setWarning(result.warning || 'Installation complete. PaperBridge will use the detected local tools.');
      await onInstalled();
      setDiagnosis(await api.setupStatus({ ...config(), mineruExecutable: result.mineruExecutable }));
    } catch (cause) {
      await refresh();
      setError(cause.message);
    } finally { setWorking(false); }
  }

  const missing = diagnosis && (diagnosis.plan.ollama || diagnosis.plan.models.length || diagnosis.plan.mineru);
  const gpu = diagnosis?.plan.gpu;
  const mineru = diagnosis?.mineru;
  return <div className="setup-panel">
    <p>PaperBridge checks this PC before installing anything. One click sets up missing local AI tools in your Windows account. MinerU and its models can require several gigabytes.</p>
    <div className="setup-heading"><strong>Detected environment</strong><button className="button outline" disabled={checking || working} onClick={refresh}><RefreshCw size={14} /> {checking ? 'Checking…' : 'Check again'}</button></div>
    {checking && !diagnosis && <p>Checking Ollama, models, MinerU, and graphics hardware…</p>}
    {diagnosis && <>
      <div className="setup-row"><span className={diagnosis.ollama.running ? 'setup-ok' : 'setup-needed'}>{diagnosis.ollama.running ? <Check size={16} /> : <Download size={16} />}</span><div><strong>Ollama</strong><small>{diagnosis.ollama.running ? 'Local API is ready' : diagnosis.ollama.installed ? 'Installed; PaperBridge can start it' : 'Not installed; official signed installer will be downloaded'}</small></div></div>
      <div className="setup-row"><span className={diagnosis.plan.models.length ? 'setup-needed' : 'setup-ok'}>{diagnosis.plan.models.length ? <Download size={16} /> : <Check size={16} />}</span><div><strong>Local models</strong><small>{diagnosis.plan.models.length ? `To download: ${diagnosis.plan.models.join(', ')}` : `Ready: ${config().models.join(', ')}`}</small></div></div>
      <div className="setup-row"><span className={diagnosis.plan.mineru ? 'setup-needed' : 'setup-ok'}>{diagnosis.plan.mineru ? <Download size={16} /> : <Check size={16} />}</span><div><strong>MinerU structured PDF parser</strong><small>{diagnosis.plan.mineru ? mineru?.compatible ? `Installed, but CUDA is not ready${mineru.runtime?.reason ? `: ${mineru.runtime.reason}` : ''}. Setup can create a private managed environment.` : mineru?.installed ? 'Existing command is not compatible with this reader; install a private compatible copy' : 'Not installed; an isolated Python and MinerU will be installed' : `${mineru.version}${mineru.runtime?.cuda ? ' · PyTorch CUDA ready' : ' · CPU pipeline available'}`}</small></div></div>
      <div className="setup-hardware"><strong>Graphics acceleration</strong><p>{diagnosis.hardware.adapters?.length ? diagnosis.hardware.adapters.map(adapter => `${adapter.name} (${adapter.vendor})`).join(' · ') : 'Windows did not report a graphics adapter.'}</p><p>{gpu.reason}</p><p>Ollama chooses its supported NVIDIA, AMD, Vulkan, or CPU backend automatically. MinerU CUDA is verified in its own Python environment after installation.</p></div>
    </>}
    {working && progress && <div className="setup-progress"><strong>{progress.message}</strong>{progress.received > 0 && <small>{formatBytes(progress.received)}{progress.total ? ` / ${formatBytes(progress.total)}` : ''}</small>}{progress.total > 0 && <progress value={progress.received} max={progress.total} />}</div>}
    {error && <p className="setup-error" role="alert">{error}</p>}
    {warning && <p className="setup-success" role="status">{warning}</p>}
    <div className="setup-actions">{working ? <button className="button danger" onClick={() => api.setupCancel()}><Square size={14} /> Cancel setup</button> : <button className="button blue" disabled={checking || !missing} onClick={install}><Download size={16} /> {missing ? 'Install missing components' : 'Local AI is ready'}</button>}</div>
    <p className="setup-footnote">Existing working installations are kept. GPU drivers are managed by Windows and your graphics vendor; this setup installs compatible app components, not drivers.</p>
  </div>;
}
