import React from 'react';
import { ALargeSmall } from 'lucide-react';
import defaults from '../electron/reading-appearance.json';
import './reading-appearance.css';

const sliders = [
  { key: 'fontSize', label: 'Reader font size', min: 14, max: 25, step: 1, unit: 'px' },
  { key: 'lineHeight', label: 'Line spacing', min: 1.3, max: 2.2, step: 0.1, unit: '' },
  { key: 'readingWidth', label: 'Reading width', min: 560, max: 1100, step: 20, unit: 'px' }
];

export function ReadingAppearanceControls({ settings, onSettings }) {
  return <>
    <div className="reading-appearance-sliders">
      {sliders.map(({ key, label, min, max, step, unit }) => <label className="reading-appearance-control" key={key}>
        <span>{label}</span>
        <span className="reading-appearance-value" aria-hidden="true">{settings[key]}{unit}</span>
        <input aria-label={label} type="range" min={min} max={max} step={step} value={settings[key]}
          aria-valuetext={`${settings[key]}${unit}`} onChange={event => onSettings({ [key]: event.target.valueAsNumber })} />
      </label>)}
    </div>
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
