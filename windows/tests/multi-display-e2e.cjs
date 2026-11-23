// Opt-in on a Windows desktop with two physical displays configured at different DPI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { defaults } = require('../electron/storage.cjs');
const { openWorkspaceView } = require('./sidebar-controls.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'physical-dpi-'));
  const title = '基于仿射不变采样的多组天文观测误差分析 — emcee v3, A Python Ensemble Sampling Toolkit for Scientific Computing.pdf';
  const pdf = path.join(dir, title);
  fs.copyFileSync(path.join(__dirname, 'mac-parity', 'emcee-v3.pdf'), pdf);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ...defaults, onboardingCompletedVersion: 0,
    autoCheckUpdates: false, pdfExtractionMode: 'pdfOnly', ollamaBaseURL: 'http://127.0.0.1:9' }));
  const exe = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const app = await electron.launch({ cwd: root, ...(exe && { executablePath: exe }),
    args: [...(exe ? [] : ['.']), '--user-data-dir=' + path.join(dir, 'profile')], env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  try {
    const page = await app.firstWindow();
    const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(({ id, scaleFactor, workArea }) => ({ id, scaleFactor, workArea })));
    const targets = [displays[0], displays.find(display => display.scaleFactor !== displays[0].scaleFactor)];
    assert.ok(targets[1], 'This test needs two connected monitors at different Windows display scales.');
    const results = [];
    async function move(target, width = 980, height = 620) {
      const area = target.workArea;
      const bounds = { x: area.x + Math.max(0, Math.floor((area.width - width) / 2)),
        y: area.y + Math.max(0, Math.floor((area.height - height) / 2)), width, height };
      await app.evaluate(({ BrowserWindow }, rect) => BrowserWindow.getAllWindows()[0].setBounds(rect), bounds);
      await page.waitForFunction(scale => Math.abs(window.devicePixelRatio - scale) < 0.025, target.scaleFactor, { timeout: 10000 });
      const id = await app.evaluate(({ BrowserWindow, screen }) => screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).id);
      assert.equal(id, target.id);
      // Windows can suggest a different physical size during the DPI change.
      // Apply the requested logical size after the window reaches its destination.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 620));
      // Non-client frame metrics vary with DPI. Validate the resulting client area against Windows.
      await page.waitForFunction(() => Math.abs(innerWidth - 1000) < 25 && Math.abs(innerHeight - 620) < 30, null, { timeout: 5000 }).catch(async error => {
        const native = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return { bounds: win.getBounds(), content: win.getContentSize(), zoom: win.webContents.getZoomFactor() }; });
        const viewport = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
        throw Error(JSON.stringify({ target, native, viewport }) + ' ' + error.message);
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
      const viewport = await page.evaluate(() => [innerWidth, innerHeight]);
      assert.ok(size.every((value, i) => Math.abs(value - viewport[i]) <= 1), JSON.stringify({ size, viewport }));
    }
    const onboarding = page.locator('.onboarding');
    await onboarding.waitFor();
    for (let step = 0; step < 6; step++) {
      for (const target of targets) {
        await move(target);
        const geometry = await onboarding.evaluate(host => {
          const footer = host.querySelector('footer');
          const buttons = [...footer.querySelectorAll('button')].filter(b => b.getClientRects().length).map(button => {
            const rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { label: button.textContent.trim(), visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && button.contains(hit) };
          });
          return { title: host.querySelector('#onboarding-page-title').textContent, buttons, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert.ok(geometry.buttons.length >= 3 && geometry.buttons.every(item => item.visible), JSON.stringify(geometry));
        assert.ok(geometry.overflow <= 1);
        results.push({ step: step + 1, scale: target.scaleFactor, title: geometry.title });
        if (step === 0) await page.screenshot({ path: path.join(dir, 'setup-' + target.scaleFactor + '.png') });
      }
      if (step < 5) await onboarding.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await onboarding.getByRole('button', { name: 'Back', exact: true }).click();
    await onboarding.getByRole('button', { name: 'Continue', exact: true }).click();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, pdf);
    await onboarding.getByRole('button', { name: 'Finish & Open PDF', exact: true }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 60000 });
    await openWorkspaceView(page, 'Reader');
    const headers = [];
    for (const target of [...targets, targets[0]]) {
      await move(target);
      const geometry = await page.evaluate(() => {
        const title = document.querySelector('.title-row h1');
        const header = title.getBoundingClientRect(), text = title.textContent;
        const metadata = document.querySelector('.title-wrap p').getBoundingClientRect();
        const toolbar = document.querySelector('.header-tools').getBoundingClientRect();
        const reader = document.querySelector('.reader-list').getBoundingClientRect();
        return { text, metaGap: metadata.top - header.bottom, toolsGap: toolbar.top - metadata.bottom, width: header.width, height: header.height, line: parseFloat(getComputedStyle(title).lineHeight),
          top: header.top, right: header.right, bottom: header.bottom, readerTop: reader.top, viewport: [innerWidth, innerHeight],
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert.equal(geometry.text, title);
      assert.ok(geometry.height >= geometry.line * 1.75 && geometry.metaGap >= -1 && geometry.toolsGap >= -1 && geometry.bottom <= geometry.readerTop && geometry.right <= geometry.viewport[0] + 1 && geometry.overflow <= 1, JSON.stringify(geometry));
      await page.screenshot({ path: path.join(dir, 'reader-' + target.scaleFactor + '.png') });
      headers.push({ scale: target.scaleFactor, viewport: geometry.viewport, height: geometry.height, lines: Math.round(geometry.height / geometry.line) });
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).onboardingCompletedVersion, 1);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('command:onboarding').click());
    await onboarding.getByRole('button', { name: 'Advanced setup', exact: true }).click();
    await page.getByRole('heading', { name: 'Local AI setup', exact: true }).waitFor();
    console.log(JSON.stringify({ dir, scales: targets.map(d => d.scaleFactor), steps: results, headers }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
