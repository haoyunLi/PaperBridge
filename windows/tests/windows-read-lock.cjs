const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');

async function withWindowsReadLock(filename, operation) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$handle = [IO.File]::Open($env:PAPERBRIDGE_TEST_LOCK_FILE, "Open", "Read", "Read")',
    'try { [Console]::WriteLine("locked"); [Console]::Out.Flush(); [void][Console]::ReadLine(); [Console]::WriteLine("releasing"); [Console]::Out.Flush(); [Threading.Thread]::Sleep(80) } finally { $handle.Dispose() }'
  ].join('\n');
  const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, env: { ...process.env, PAPERBRIDGE_TEST_LOCK_FILE: filename }, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(locker, 'close');
  const output = createInterface({ input: locker.stdout });
  try {
    const [line] = await Promise.race([once(output, 'line'), closed.then(([code]) => { throw Error('Lock helper exited: ' + code); })]);
    assert.equal(line, 'locked');
    await operation(async () => {
      const releasing = once(output, 'line');
      locker.stdin.end('\n');
      assert.deepEqual(await releasing, ['releasing']);
    });
  } finally {
    if (!locker.stdin.writableEnded) locker.stdin.end('\n');
    assert.equal((await closed)[0], 0);
  }
}

module.exports = { withWindowsReadLock };
