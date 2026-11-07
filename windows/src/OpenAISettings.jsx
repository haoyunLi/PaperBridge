import React, { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';

function Detail({ children }) { return <p className="settings-detail">{children}</p>; }

export default function OpenAISettings({ settings, onSettings, locked, tools }) {
  const [key, setKey] = useState('');
  useEffect(() => { tools.onKeyStatus(); return () => setKey(''); }, []);
  const modelKeys = [
    ['openAITranslationModel', 'Translation'], ['openAISummaryModel', 'Summary'],
    ['openAIExplainModel', 'Paragraph explanation'], ['openAIQuickLookupModel', 'Quick lookup']
  ];
  const options = value => [...new Set([value, ...tools.models].filter(Boolean))].sort();
  return <>
    {(tools.error || tools.status) && <p className={tools.error ? 'settings-error' : 'settings-status'} role={tools.error ? 'alert' : 'status'}>{tools.error || tools.status}</p>}
    <section className="settings-section"><h3>OpenAI API key</h3>
      <p><KeyRound size={15} /> {tools.hasKey ? 'Key saved for this Windows account' : 'No saved API key'}</p>
      <fieldset disabled={locked || tools.saving}>
        <label>New OpenAI API key<input type="password" autoComplete="off" value={key} placeholder="sk-…" onChange={event => setKey(event.target.value)} /></label>
        <div className="row"><button className="button blue" disabled={!key.trim()} onClick={async () => { if (await tools.onSaveKey(key)) setKey(''); }}>{tools.hasKey ? 'Replace saved key' : 'Save key'}</button><button className="button danger" disabled={!tools.hasKey} onClick={() => { setKey(''); tools.onRemoveKey(); }}><Trash2 size={14} />Remove key</button></div>
      </fieldset>
      <Detail>Encrypted with Windows DPAPI through Electron safeStorage, never written to settings, paper workspaces, or exports. Saving a key does not send paper text or test a model. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Manage API keys</a>.</Detail>
    </section>
    <section className="settings-section"><h3>Permission for this session</h3>
      <Detail>Selection requests send selected text, nearby context, the paper title, and matching terminology. Full translation and summary send extracted text in batches. PDF files and image bytes are not uploaded.</Detail>
      <label className="settings-checkbox"><input type="checkbox" checked={tools.consent} disabled={locked && !tools.consent || !tools.hasKey} onChange={event => tools.onConsent(event.target.checked)} />I allow this text to be sent to OpenAI for this session</label>
      <Detail>Permission is never restored after an app restart. Turning it off cancels active OpenAI work and stops later batches, but cannot recall text already sent. PaperBridge never falls back to OpenAI automatically.</Detail>
    </section>
    <section className="settings-section"><h3>OpenAI task models</h3>
      <button className="button outline" disabled={locked || !tools.hasKey || tools.refreshing} onClick={tools.onRefresh}><RefreshCw size={15} />{tools.refreshing ? 'Refreshing…' : 'Refresh available models'}</button>
      <Detail>Refresh calls GET /v1/models only: no inference and no paper text. The list does not guarantee Responses API support or pricing. Choose an accessible text model or enter an ID manually; no paid model is selected automatically.</Detail>
      <fieldset disabled={locked}><div className="settings-grid">{modelKeys.map(([name, label]) => <label key={name}>{label}<select aria-label={`${label} available models`} value={settings[name]} onChange={event => onSettings({ [name]: event.target.value })}><option value="">Choose a model</option>{options(settings[name]).map(model => <option key={model}>{model}</option>)}</select><input aria-label={`${label} model ID`} value={settings[name]} placeholder="Manual model ID" onChange={event => onSettings({ [name]: event.target.value })} /></label>)}</div>
        <button className="button outline" disabled={!settings.openAITranslationModel.trim()} onClick={() => onSettings({ openAISummaryModel: settings.openAITranslationModel.trim(), openAIExplainModel: settings.openAITranslationModel.trim(), openAIQuickLookupModel: settings.openAITranslationModel.trim() })}>Use translation model for all tasks</button>
      </fieldset>
      <Detail>Quick lookup handles selected-text translation and explanation. Empty means unconfigured, never a local-model fallback.</Detail>
    </section>
    <section className="settings-section"><h3>Data and costs</h3><Detail>Requests use the Responses API with store: false. This does not promise zero retention. API usage is billed separately from ChatGPT, and whole-paper tasks can make multiple paid requests.</Detail><div className="row"><a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">OpenAI data controls</a><a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer">API usage and costs</a></div></section>
  </>;
}
