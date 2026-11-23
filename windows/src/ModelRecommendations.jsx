import React from 'react';
import { Check, Download } from 'lucide-react';
import { hasOllamaModel } from '../electron/ollama-models.mjs';
import { fitsModelEstimate, isCatalogModelSelected, largestDedicatedAdapter, suggestedTranslationModel } from './modelCatalog.mjs';
import { describeAdapter, formatMemory } from './hardwareDisplay.mjs';
import './model-recommendations.css';

export function ModelMemoryGuide({ hardware, storage, className }) {
  const memory = Number(hardware?.systemMemoryBytes) / 1024 ** 3;
  const adapter = largestDedicatedAdapter(hardware);
  const model = suggestedTranslationModel(hardware, adapter);
  let guidance = 'This estimate uses system RAM and allows room for Windows and the model runtime.';
  if (adapter) {
    const sizing = fitsModelEstimate(model, adapter) ? 'The estimate leaves 20% of dedicated memory for context and runtime.'
      : 'Even the smallest model may need to use system RAM.';
    guidance = `Based on system RAM and ${describeAdapter(adapter)}. ${sizing}`;
  }
  return <div className={className}>
    <strong>{Number.isFinite(memory) && memory > 0 ? `This PC: ${Math.round(memory)} GiB system RAM` : 'System memory is not available'}</strong>
    <span>Starting suggestion: {model.title}</span>
    <p>{guidance} Ollama reports GPU use after loading the model.</p>
    {storage && <p>Windows model drive {storage.drive} · {formatMemory(storage.freeBytes)} free at last check</p>}
  </div>;
}

export function ModelCard({ model, installed, selected, active, disabled, storage, onAction }) {
  return <article className={`model-card onboarding-model-card ${selected ? 'selected' : ''}`} data-model-id={model.id}>
    <div className="model-card-copy"><div className="model-card-title"><h3>{model.title}</h3><span>{model.badge}</span>{installed && <b><Check size={12} /> Installed</b>}</div>
      <code>{model.id}</code><p>{model.detail}</p><small>{model.guidance}</small>
      {!installed && storage && storage.freeBytes < model.downloadGB * 1e9 && <small className="model-space-warning">
        The full download may need more space than this drive has. Ollama can reuse existing model files.
      </small>}
      <div className="model-card-meta"><span>About {model.downloadGB.toFixed(1)} GB download</span><a href={model.url} target="_blank" rel="noreferrer">Official model details</a></div>
    </div>
    <button className={`button ${selected ? 'outline' : 'blue'}`} disabled={disabled || selected || active} onClick={onAction}>
      {selected ? <Check size={14} /> : <Download size={14} />}{active ? 'Downloading…' : selected ? 'Selected' : installed ? 'Use model' : 'Download & use'}
    </button>
  </article>;
}

export default function ModelRecommendations({ items, settings, models = [], busy = false, activeModel, storage, onUse, onDownload }) {
  return <div className="model-recommendations">{items.map(model => {
    const installed = hasOllamaModel(models, model.id);
    return <ModelCard key={model.id} model={model} installed={installed} storage={storage}
      selected={isCatalogModelSelected(settings, model, models)} active={activeModel === model.id} disabled={busy}
      onAction={() => installed ? onUse(model) : onDownload(model)} />;
  })}</div>;
}
