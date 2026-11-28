const { execFile } = require('node:child_process');
const path = require('node:path');

function stopWorker(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  if (process.platform !== 'win32' || !Number.isSafeInteger(child.pid) || child.pid <= 0) {
    child.kill();
    return;
  }
  // A Python or package-manager launcher can delegate work to a second process.
  const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
  execFile(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, error => {
    if (error && child.exitCode == null && child.signalCode == null) child.kill();
  });
}

module.exports = { stopWorker };
