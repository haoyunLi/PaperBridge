import React, { useId } from 'react';
import ModelRecommendations from './ModelRecommendations.jsx';
import { TRANSLATION_MODELS, ASSISTANT_MODELS, MODEL_CATALOG_VERIFIED_AT, suggestedTranslationModel } from './modelCatalog.mjs';
import './settings-models.css';

export default function SettingsModels({ settings, models = [], hardware, busy = false, pullProgress, onUse, onDownload }) {
  const id = useId();
  const memoryGiB = Number(hardware?.systemMemoryBytes) / 1024 ** 3;
  const suggested = suggestedTranslationModel(hardware);
  const downloading = pullProgress?.phase === 'pulling';
  const cardProps = { settings, models, busy: Boolean(busy || downloading), activeModel: downloading ? pullProgress.model : null, onUse, onDownload };

  return <div className="settings-models">
    <div className="settings-model-memory"><strong>{Number.isFinite(memoryGiB) && memoryGiB > 0 ? `This PC: ${Math.round(memoryGiB)} GiB system RAM` : 'System memory is not available'}</strong><span>Starting suggestion: {suggested.title}</span>
      <p>This suggestion uses system RAM, which is separate from GPU VRAM. Allow additional memory for Windows, model runtime and context. Ollama decides how much can run on the GPU.</p>
    </div>
    <section className="settings-model-group" aria-labelledby={`${id}-translation`} data-model-role="translation">
      <header><h3 id={`${id}-translation`}>Translation models</h3><span>Required for translation</span></header>
      <p>Choose one TranslateGemma size. Selecting it updates assistant roles that followed the previous translation model or whose model is missing. Other installed assistant selections are kept.</p>
      <ModelRecommendations items={TRANSLATION_MODELS} {...cardProps} />
    </section>
    <section className="settings-model-group" aria-labelledby={`${id}-assistant`} data-model-role="assistant">
      <header><h3 id={`${id}-assistant`}>Explanation models</h3><span>Optional</span></header>
      <p>Select one assistant for Summary, paragraph explanations and quick lookup. Your translation model stays selected for translation. Assign each role separately in Models.</p>
      <ModelRecommendations items={ASSISTANT_MODELS} {...cardProps} />
    </section>
    <p className="settings-model-footnote">Approximate download sizes checked {MODEL_CATALOG_VERIFIED_AT}. Runtime memory is additional; shared model files can reduce a download. Downloads start only when you choose Download &amp; use and require Ollama to be running.</p>
  </div>;
}
