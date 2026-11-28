const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const { createMineruJobGuard } = require('../electron/mineru-job.cjs');
const { SetupManager } = require('../electron/setup.cjs');

async function waitFor(check, ms) {
  const deadline = Date.now() + ms;
  do { if (check()) return true; await delay(40); } while (Date.now() < deadline);
  return false;
}

for (const operation of ['extract', 'setup']) {
  test('cancelling Windows ' + operation + ' stops workers started by its launcher', { skip: process.platform !== 'win32' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbridge-worker-'));
    const ready = path.join(dir, 'worker.pid');
    // Both processes have finite lifetimes, including when testing the old cancellation path.
    const worker = path.join(dir, 'worker.cjs');
    fs.writeFileSync(worker, "require('node:fs').writeFileSync(process.argv[2], String(process.pid)); setTimeout(() => {}, 7000);");
    const env = { ...process.env, PB_TEST_NODE: process.execPath, PB_TEST_WORKER: worker, PB_TEST_READY: ready };
    const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = ['-NoProfile', '-NonInteractive', '-Command', '& $env:PB_TEST_NODE $env:PB_TEST_WORKER $env:PB_TEST_READY'];
    let cancel, done;
    try {
      if (operation === 'extract') {
        const guard = createMineruJobGuard(), job = guard.begin();
        const child = spawn(executable, args, { env, stdio: 'ignore', windowsHide: true });
        done = new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
        guard.attach(job, child);
        cancel = () => guard.cancel();
      } else {
        const setup = new SetupManager({ toolsRoot: dir, emit() {} });
        setup.controller = new AbortController();
        done = setup.run(executable, args, 'mineru', 'Starting isolated workers', { env }).then(() => null, error => error);
        cancel = () => setup.cancel();
      }
      assert.ok(await waitFor(() => fs.existsSync(ready) && /^\d+$/.test(fs.readFileSync(ready, 'utf8')), 5000));
      const pid = Number(fs.readFileSync(ready, 'utf8'));
      assert.ok(pid > 0);
      assert.ok(cancel());
      const stopped = await waitFor(() => {
        try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
      }, 2000);
      assert.ok(stopped, 'The worker must stop together with its owning launcher');
      const result = await done;
      if (operation === 'setup') assert.equal(result?.name, 'AbortError');
    } finally {
      if (fs.existsSync(ready)) fs.unlinkSync(ready);
      fs.unlinkSync(worker); fs.rmdirSync(dir);
    }
  });
}
