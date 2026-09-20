const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron } = require('playwright-core');

async function run() {
  const root = path.resolve(__dirname, '..');
  const binary = path.join(root, 'release', 'win-unpacked', 'PaperBridge.exe');
  if (!fs.existsSync(binary)) throw new Error('Run npm run dist before the packaged smoke test.');
  const workspace = path.join(root, 'test-artifacts', 'packaged-workspace');
  if (!path.resolve(workspace).startsWith(path.resolve(root, 'test-artifacts') + path.sep)) throw new Error('Unexpected packaged test path');
  fs.rmSync(workspace, { recursive: true, force: true });
  const app = await electron.launch({ executablePath: binary, cwd: root, env: { ...process.env, PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.welcome', { timeout: 20000 });
    await page.getByRole('button', { name: 'Try a Practice Paper' }).first().click();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.waitForSelector('.block');
    console.log('Packaged Windows executable opened the Reader successfully.');
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
