import React from 'react';
import { ALargeSmall } from 'lucide-react';
import defaults from '../electron/reading-appearance.json';
import { normalizeReadingAppearance, readingAppearanceControls } from '../electron/reading-appearance.mjs';
import './reading-appearance.css';

export function ReadingAppearanceControls({ settings, onSettings }) {
  const appearance = normalizeReadingAppearance(settings);
  return <>
    <div className="reading-appearance-sliders">
      {readingAppearanceControls(settings).map(({ key, label, min, max, step, unit, value }) => <label className="reading-appearance-control" key={key}>
        <span>{label}</span>
        <span className="reading-appearance-value" aria-hidden="true">{value}{unit}</span>
        <input aria-label={label} type="range" min={min} max={max} step={step} value={value}
          aria-valuetext={key === 'lineHeight' ? `${value} times the text size` : key === 'lineSpacing' ? `${value} extra pixels` : `${value}${unit}`}
          onChange={event => onSettings({ [key]: event.target.valueAsNumber })} />
      </label>)}
    </div>
    {appearance.lineHeight !== null && <div className="reading-appearance-legacy">
      <p className="reading-appearance-help">Your saved spacing scales with text size. Use extra spacing to add a fixed gap between lines.</p>
      <button className="button outline" onClick={() => onSettings({ lineSpacing: defaults.lineSpacing, lineHeight: null })}>Use extra spacing</button>
    </div>}
    <p className="reading-appearance-help">Applies to the Reader and text previews. Original PDF pages keep their own layout and zoom.</p>
    <button className="button outline" onClick={() => onSettings(defaults)}>Reset Appearance</button>
  </>;
}

export function ReadingAppearancePopover({ settings, onSettings, disabled }) {
  return <>
    <button className="icon-button reading-appearance-trigger" aria-label="Reading Appearance" title="Reading appearance"
      popoverTarget="reading-appearance" aria-haspopup="dialog" disabled={disabled}><ALargeSmall size={19} /></button>
    {!disabled && <div id="reading-appearance" className="reading-appearance-popover" popover="auto" role="dialog"
      aria-labelledby="reading-appearance-title"
      onToggle={event => { if (event.newState === 'open') event.currentTarget.querySelector('input')?.focus({ preventScroll: true }); }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      <h2 id="reading-appearance-title">Reading Appearance</h2>
      <ReadingAppearanceControls settings={settings} onSettings={onSettings} />
    </div>}
  </>;
}
