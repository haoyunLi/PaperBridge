const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const version = require('../package.json').version;
  const binary = path.resolve(process.argv[2] || path.join(root, 'release', `PaperBridge-Windows-${version}-x64-Portable.exe`));
  await fs.access(binary);
  const artifacts = path.join(root, 'test-artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(artifacts, 'portable-relaunch-'));
  const profile = path.join(workspace, 'profile');
  const env = { ...process.env, PAPERBRIDGE_WORKSPACE: workspace, PAPERBRIDGE_TOOLS_ROOT: path.join(workspace, 'tools') };
  await fs.writeFile(path.join(workspace, 'settings.json'), JSON.stringify({
    pdfExtractionMode: 'pdfOnly', autoCheckUpdates: false, ollamaBaseURL: 'http://127.0.0.1:9'
  }));
  const children = [];
  function launch(args) {
    const child = spawn(binary, ['--user-data-dir=' + profile, ...args], { cwd: workspace, env, windowsHide: true, stdio: 'ignore' });
    children.push(child);
    return child;
  }
  async function waitForExit(child) {
    const deadline = Date.now() + 45000;
    while (child.exitCode === null && Date.now() < deadline) await delay(100);
    assert.equal(child.exitCode, 0, 'Portable should exit normally');
  }
  let browser;
  try {
    const first = launch(['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1']);
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port;
    const deadline = Date.now() + 45000;
    while (!port && Date.now() < deadline) {
      assert.equal(first.exitCode, null, 'First launch exited before the reader opened');
      try { port = Number((await fs.readFile(portFile, 'utf8')).split('\n')[0]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!port) await delay(150);
    }
    assert.ok(port > 0, 'Expected a debugging port from the isolated reader');
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page');
    await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
    await page.locator('.welcome').waitFor();
    await waitForExit(launch([]));
    const pdf = await fs.readFile(path.join(__dirname, 'mac-parity', 'emcee-v3.pdf'));
    await page.evaluate(base64 => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'emcee-v3.pdf', { type: 'application/pdf' }));
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, pdf.toString('base64'));
    await page.getByRole('heading', { name: 'emcee-v3.pdf', exact: true }).waitFor();
    await openWorkspaceView(page, 'Reader');
    await page.locator('.source-text').filter({ hasText: 'emcee v3: A Python ensemble sampling toolkit for affine-invariant MCMC' }).first().waitFor();
    await openWorkspaceView(page, 'Paper');
    await page.waitForFunction(() => {
      const sheet = document.querySelector('canvas[aria-label="Original PDF page 1"]');
      if (!sheet || sheet.width < 400 || sheet.height < 400) return false;
      const preview = document.createElement('canvas');
      preview.width = 128;
      preview.height = 160;
      const context = preview.getContext('2d');
      context.drawImage(sheet, 0, 0, preview.width, preview.height);
      const { data } = context.getImageData(0, 0, preview.width, preview.height);
      let ink = 0;
      let paper = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 255 && data[i] < 200) ink++;
        if (data[i + 3] === 255 && data[i] > 245) paper++;
      }
      return ink > 50 && paper > 1000;
    }, undefined, { timeout: 20000, polling: 200 });
    await page.close();
    await waitForExit(first);
    console.log('Opened Portable twice and read the extracted article and original PDF from the first process.');
  } finally {
    await browser?.close();
    for (const child of children) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      }
    }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
