import React from 'react';
import { Undo2, X } from 'lucide-react';
import './reader-toolbar.css';

const modes = [
  { value: 'bilingual', label: 'Bilingual' },
  { value: 'source', label: 'Original' },
  { value: 'translation', label: 'Translation' }
];

export default function ReaderToolbar({ displayMode, onDisplayMode, search, onSearch, searchRef, canUndo, onUndo }) {
  return <div className="reader-top" role="region" aria-label="Reader controls">
    <div className="reader-display-modes" role="radiogroup" aria-label="Reading mode">
      {modes.map(mode => <label key={mode.value}>
        <input type="radio" name="reader-display-mode" value={mode.value} checked={displayMode === mode.value}
          onChange={() => onDisplayMode(mode.value)} />
        <span>{mode.label}</span>
      </label>)}
    </div>
    <div className="reader-search">
      <input ref={searchRef} className="search" aria-label="Search original or translation"
        aria-keyshortcuts="Control+F" placeholder="Search original or translation" value={search}
        onChange={event => onSearch(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          onSearch('');
          event.currentTarget.blur();
        }} />
      {search && <button className="icon-button clear-reader-search" aria-label="Clear search" title="Clear search"
        onClick={() => { onSearch(''); searchRef.current?.focus({ preventScroll: true }); }}><X size={14} /></button>}
    </div>
    <button className="icon-button undo-button" aria-label="Undo last change" title="Undo last change"
      disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button>
  </div>;
}
