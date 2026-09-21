import React from 'react';
import { Check, Download } from 'lucide-react';
import { isCatalogModelSelected } from './modelCatalog.mjs';
import './model-recommendations.css';

export function ModelCard({ model, installed, selected, active, disabled, onAction }) {
  return <article className={`model-card onboarding-model-card ${selected ? 'selected' : ''}`} data-model-id={model.id}>
    <div className="model-card-copy"><div className="model-card-title"><h3>{model.title}</h3><span>{model.badge}</span>{installed && <b><Check size={12} /> Installed</b>}</div>
      <code>{model.id}</code><p>{model.detail}</p><small>{model.guidance}</small>
      <div className="model-card-meta"><span>About {model.downloadGB.toFixed(1)} GB download</span><a href={model.url} target="_blank" rel="noreferrer">Official model details</a></div>
    </div>
    <button className={`button ${selected ? 'outline' : 'blue'}`} disabled={disabled || selected || active} onClick={onAction}>
      {selected ? <Check size={14} /> : <Download size={14} />}{active ? 'Downloading…' : selected ? 'Selected' : installed ? 'Use model' : 'Download & use'}
    </button>
  </article>;
}

export default function ModelRecommendations({ items, settings, models = [], busy = false, activeModel, onUse, onDownload }) {
  return <div className="model-recommendations">{items.map(model => {
    const installed = models.includes(model.id);
    return <ModelCard key={model.id} model={model} installed={installed}
      selected={isCatalogModelSelected(settings, model, models)} active={activeModel === model.id} disabled={busy}
      onAction={() => installed ? onUse(model) : onDownload(model)} />;
  })}</div>;
}
