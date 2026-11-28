const assert = require('node:assert/strict');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

async function launchTestReader({ env, args = [], executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE, ...options }) {
  assert.ok(env.PAPERBRIDGE_WORKSPACE, 'Desktop tests require an isolated paper workspace.');
  const launchArgs = executablePath ? [...args] : ['.', ...args];
  if (!launchArgs.some(arg => arg.startsWith('--user-data-dir='))) {
    launchArgs.push('--user-data-dir=' + path.join(env.PAPERBRIDGE_WORKSPACE, 'profile'));
  }
  const app = await electron.launch({ ...options, executablePath, args: launchArgs, env });
  if (executablePath) {
    try {
      const running = await app.evaluate(({ app }) => ({ path: app.getPath('exe'), packaged: app.isPackaged }));
      assert.equal(running.packaged, true, 'Desktop acceptance must run the packaged reader.');
      assert.equal(path.relative(executablePath, running.path), '', 'Desktop acceptance launched a different binary.');
    } catch (error) {
      await app.close();
      throw error;
    }
  }
  return app;
}
module.exports = { launchTestReader };
