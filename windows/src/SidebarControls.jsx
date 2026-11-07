import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, Cloud, Cpu, FileText, Languages, RefreshCw, Settings2 } from 'lucide-react';
import './sidebar-controls.css';

export function SidebarLanguage({ settings, languages, disabled, onChange }) {
  const [savedLanguages, setSavedLanguages] = useState([]);
  const currentLanguages = [settings.sourceLanguage, settings.targetLanguage]
    .filter(language => typeof language === 'string' && language.trim());
  const options = [...new Set([...languages, ...savedLanguages, ...currentLanguages])];
  useEffect(() => {
    // Keep old saved values available after choosing another language so users
    // can return to their existing translation cache without rewriting settings.
    setSavedLanguages(previous => {
      const next = [...new Set([...previous, ...currentLanguages.filter(language => !languages.includes(language))])];
      return next.length === previous.length ? previous : next;
    });
  }, [languages, settings.sourceLanguage, settings.targetLanguage]);
  return <section className="side-group sidebar-language" aria-label="Translation languages">
    <div className="side-label"><span><Languages size={14} /> LANGUAGE</span></div>
    <fieldset disabled={disabled}>
      <label>From<select aria-label="Sidebar from language" value={settings.sourceLanguage} onChange={event => onChange({ sourceLanguage: event.target.value })}>{options.map(language => <option key={language}>{language}</option>)}</select></label>
      <button className="side-action sidebar-swap" aria-label="Swap languages" onClick={() => onChange({ sourceLanguage: settings.targetLanguage, targetLanguage: settings.sourceLanguage })}><ArrowRightLeft size={13} /> Swap</button>
      <label>To<select aria-label="Sidebar to language" value={settings.targetLanguage} onChange={event => onChange({ targetLanguage: event.target.value })}>{options.map(language => <option key={language}>{language}</option>)}</select></label>
    </fieldset>
  </section>;
}

export function SidebarAIStatus({ settings, ollamaStatus, ollamaError, refreshingModels, onRefreshModels, openAIConsent,
  enabled = true, parserRevision = 0, onOpenAISettings, onOpenSettings }) {
  const [check, setCheck] = useState(0);
  const [parser, setParser] = useState({ executable: null, checking: false, value: null, error: '' });
  const executable = settings.mineruExecutable || '';
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setParser({ executable, checking: true, value: null, error: '' });
    window.paperBridge.mineruStatus(executable)
      .then(value => { if (current) setParser({ executable, checking: false, value, error: '' }); })
      .catch(error => { if (current) setParser({ executable, checking: false, value: null, error: error.message }); });
    return () => { current = false; };
  }, [executable, enabled, parserRevision, check]);

  const current = parser.executable === executable;
  const checkingParser = enabled && (!current || parser.checking);
  const available = current && parser.value?.compatible;
  const parserMessage = !current || parser.checking ? 'Checking the local parser…'
    : parser.error || (available ? parser.value.version ? `Version ${parser.value.version}` : 'Compatible local installation.' : parser.value?.reason || 'Use Local AI setup to install MinerU.');
  const online = settings.aiProvider === 'openai';
  return <section className="side-group sidebar-ai-status" aria-label="AI and parser status">
    <div className="side-label"><span>{online ? <Cloud size={14} /> : <Cpu size={14} />} {online ? 'OPENAI' : 'LOCAL AI'}</span></div>
    {online ? <>
      <p className="sidebar-ai-message">{openAIConsent ? 'Text analysis uses OpenAI. API usage is billed to your account.' : 'Online analysis is paused. Enable it in Settings > Models.'}</p>
      <p className="sidebar-model-name" title={settings.openAITranslationModel || undefined}>{settings.openAITranslationModel || 'No translation model selected'}</p>
      <button className="side-action" onClick={onOpenAISettings}>Open AI Settings</button>
    </> : <>
      <div className="sidebar-runtime-row"><span role="status" className="sidebar-runtime-label"><i className={ollamaStatus === 'ready' && !refreshingModels ? 'ready' : ''} />{refreshingModels ? 'Checking Ollama…' : ollamaStatus === 'ready' ? 'Ollama ready' : ollamaStatus === 'unavailable' ? 'Ollama unavailable' : 'Check Ollama'}</span><button className="sidebar-refresh" aria-label="Refresh Ollama models" title="Refresh Ollama models" aria-busy={refreshingModels} disabled={refreshingModels} onClick={onRefreshModels}><RefreshCw size={14} /></button></div>
      {ollamaError && <p className="sidebar-ai-message" role="status">{ollamaError}</p>}
    </>}
    <div className="sidebar-parser-status">
      <div className="sidebar-runtime-row"><span role="status" className="sidebar-runtime-label"><i className={available && !checkingParser ? 'ready' : ''} />{checkingParser ? 'Checking MinerU…' : available ? 'MinerU ready' : 'MinerU unavailable'}</span><button className="sidebar-refresh" aria-label="Refresh MinerU status" title="Refresh MinerU status" aria-busy={checkingParser} disabled={checkingParser || !enabled} onClick={() => setCheck(value => value + 1)}><RefreshCw size={14} /></button></div>
      <p className="sidebar-parser-message" title={parserMessage}>{parserMessage}</p>
    </div>
    <p className="sidebar-pdf-available"><FileText size={13} /> Original PDF always available</p>
    <button className="sidebar-settings-button" onClick={onOpenSettings}><Settings2 size={14} /><span>Parser, Models &amp; Settings</span></button>
  </section>;
}
