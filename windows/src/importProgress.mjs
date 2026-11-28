export function mineruImportStage(message) {
  const text = String(message || '').trim();
  const count = text.match(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?:\s|$)/)?.slice(1).join(' of ');
  const suffix = count ? ` · ${count}` : '';
  if (/formula|equation|latex/i.test(text)) return `Recognizing formulas${suffix}`;
  if (/ocr|text recogn|reading order|markdown|parse/i.test(text)) return `Recognizing text${suffix}`;
  if (/layout|page analy|detect/i.test(text)) return `Analyzing page layout${suffix}`;
  return `MinerU is processing the PDF${suffix}`;
}
