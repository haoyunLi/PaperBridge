// Only paper links that open in the browser or mail application use the OS handler.
export function externalPaperURL(value) {
  if (typeof value !== 'string' || !/^(?:https?:\/\/|mailto:)/i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
