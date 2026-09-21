function officialOllamaUrl(value) {
  // Check the raw authority too: URL.port normalizes an explicitly supplied :443.
  if (typeof value !== 'string' || !/^https:\/\/ollama\.com\/(?:download\/windows|library\/[a-z0-9][a-z0-9_.-]*(?::[a-z0-9][a-z0-9_.-]*)?)$/i.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'ollama.com' || url.username || url.password || url.port || url.search || url.hash) return null;
  if (url.pathname !== '/download/windows' && !/^\/library\/[a-z0-9][a-z0-9_.-]*(?::[a-z0-9][a-z0-9_.-]*)?$/i.test(url.pathname)) return null;
  return url.href;
}

function createOfficialLinkHandler(openExternal, onError = () => {}) {
  return ({ url }) => {
    const official = officialOllamaUrl(url);
    if (official) Promise.resolve().then(() => openExternal(official)).catch(onError);
    return { action: 'deny' };
  };
}

module.exports = { officialOllamaUrl, createOfficialLinkHandler };
