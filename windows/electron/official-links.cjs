function officialOllamaUrl(value) {
  // Check the raw authority too: URL.port normalizes an explicitly supplied :443.
  if (typeof value !== 'string' || !/^https:\/\/ollama\.com\/(?:download\/windows|library\/[a-z0-9][a-z0-9_.-]*(?::[a-z0-9][a-z0-9_.-]*)?)$/i.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'ollama.com' || url.username || url.password || url.port || url.search || url.hash) return null;
  if (url.pathname !== '/download/windows' && !/^\/library\/[a-z0-9][a-z0-9_.-]*(?::[a-z0-9][a-z0-9_.-]*)?$/i.test(url.pathname)) return null;
  return url.href;
}

function officialOpenAIUrl(value) {
  // Validate the raw spelling as well as URL fields. WHATWG URL drops an
  // explicitly supplied default port (":443"), which would otherwise make a
  // broader-than-documented authority look identical to the approved URL.
  if (typeof value !== 'string' || !/^https:\/\/(?:platform\.openai\.com\/(?:api-keys|usage)|developers\.openai\.com\/api\/docs\/guides\/your-data)$/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
  const allowed = url.hostname === 'platform.openai.com' && ['/api-keys', '/usage'].includes(url.pathname)
    || url.hostname === 'developers.openai.com' && url.pathname === '/api/docs/guides/your-data';
  return allowed ? url.href : null;
}

function createOfficialLinkHandler(openExternal, onError = () => {}) {
  return ({ url }) => {
    const official = officialOllamaUrl(url) || officialOpenAIUrl(url);
    if (official) Promise.resolve().then(() => openExternal(official)).catch(onError);
    return { action: 'deny' };
  };
}

module.exports = { officialOllamaUrl, officialOpenAIUrl, createOfficialLinkHandler };
