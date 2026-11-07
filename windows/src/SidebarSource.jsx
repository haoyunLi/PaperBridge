import React, { useEffect, useRef } from 'react';
import { BookOpen, FilePlus2, FileText } from 'lucide-react';
import './sidebar-source.css';

export default function SidebarSource({ text, onText, expanded, onExpanded, focusRequest, busy, onOpenPDF, onLoad, onPractice }) {
  const input = useRef(null);
  useEffect(() => {
    if (expanded && focusRequest) input.current?.focus();
  }, [expanded, focusRequest]);

  return <section className="side-group sidebar-source" aria-label="Source">
    <div className="side-label">SOURCE</div>
    <button className="side-primary" disabled={busy} onClick={onOpenPDF}><FilePlus2 size={16} /> Open PDF</button>
    <details className="sidebar-paste" open={expanded} onToggle={event => {
      if (event.currentTarget.isConnected) onExpanded(event.currentTarget.open);
    }}>
      <summary><FileText size={15} /> Paste Text</summary>
      <div className="sidebar-paste-input">
        <textarea ref={input} className="paste-area" aria-label="Paste text" value={text}
          onChange={event => onText(event.target.value)} placeholder="Paste an abstract or paper..." />
        {text && !text.trim() && <span className="sidebar-paste-placeholder" aria-hidden="true">Paste an abstract or paper...</span>}
      </div>
      <div className="sidebar-paste-actions">
        <button disabled={busy || !text.trim()} onClick={() => onLoad(text)}>Load Text</button>
        <button disabled={busy || !text.length} onClick={() => onText('')}>Clear</button>
      </div>
    </details>
    <button className="side-action" disabled={busy} onClick={onPractice}><BookOpen size={15} /> Try a Practice Paper</button>
  </section>;
}
