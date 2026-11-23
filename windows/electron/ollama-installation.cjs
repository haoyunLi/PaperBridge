const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const exec = promisify(execFile);

function localOllamaURL(value, endpoint) {
  const url = new URL(value || 'http://localhost:11434');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PaperBridge only connects to a local Ollama HTTP server.');
  }
  return new URL(endpoint, url);
}

function executableIn(directory, name) {
  if (!directory || !path.isAbsolute(directory)) return '';
  const file = path.join(directory, name);
  try { return fs.statSync(file).isFile() ? file : ''; } catch { return ''; }
}

async function registeredDirectory() {
  if (process.platform !== 'win32' || !process.env.SystemRoot) return '';
  const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const key = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/{44E83376-CE68-45EB-8FC1-393500EB558C}_is1';
  const query = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " +
    "Get-ItemPropertyValue -LiteralPath '" + key + "' -Name InstallLocation -ErrorAction SilentlyContinue";
  try {
    const { stdout } = await exec(shell, ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, timeout: 4000 });
    return stdout.trim();
  } catch { return ''; }
}

async function ollamaPath(environment = process.env, readRegistered = registeredDirectory) {
  const directories = String(environment.PATH || environment.Path || '').split(path.delimiter)
    .map(directory => directory.trim().replace(/^"|"$/g, ''));
  if (environment.LOCALAPPDATA) directories.unshift(path.join(environment.LOCALAPPDATA, 'Programs', 'Ollama'));
  for (const directory of directories) {
    const file = executableIn(directory, 'ollama app.exe') || executableIn(directory, 'ollama.exe');
    if (file) return file;
  }
  const registered = await readRegistered();
  return executableIn(registered, 'ollama app.exe') || executableIn(registered, 'ollama.exe');
}

function ollamaLaunch(file, baseURL) {
  const endpoint = localOllamaURL(baseURL, '/');
  const standalone = path.basename(file).toLowerCase() === 'ollama.exe';
  // The tray app can already own the default endpoint. A second loopback port needs its own server.
  const server = standalone ? file : endpoint.port !== '11434' && executableIn(path.dirname(file), 'ollama.exe');
  return server ? { executable: server, args: ['serve'], host: endpoint.origin }
    : { executable: file, args: [], host: null };
}

module.exports = { localOllamaURL, ollamaLaunch, ollamaPath };
