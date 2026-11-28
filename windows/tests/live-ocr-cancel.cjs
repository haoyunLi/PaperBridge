const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { _electron: electron } = require('playwright-core');
const { defaults, createStore } = require('../electron/storage.cjs');

async function inspect(script) {
  const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 60000 });
  return JSON.parse(stdout.trim() || '[]');
}

async function run() {
  assert.equal(process.platform, 'win32');
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'test-artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  const dir = fs.mkdtempSync(path.join(artifacts, 'live-parser-cancel-'));
  const executablePath = process.env.PAPERBRIDGE_TEST_EXECUTABLE;
  const mineru = process.env.PAPERBRIDGE_LIVE_MINERU;
  assert.ok(executablePath && fs.existsSync(executablePath) && mineru && fs.existsSync(mineru));
  const store = createStore(dir);
  store.saveSettings({ ...defaults, autoCheckUpdates: false, onboardingCompletedVersion: 1, pdfExtractionMode: 'mineruOnly', mineruBackend: 'auto', mineruExecutable: mineru });
  const id = 'd'.repeat(64), name = 'Keep this paper while cancelling OCR';
  store.savePaper({ id, name, type: 'text', sourceMode: 'text', extraction: 'Pasted text', position: { tab: 'Reader' },
    blocks: [{ id: 1, text: 'The detector measured 532 nm.', bookmark: true }] });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-cancel-'));
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + path.join(dir, 'profile')], cwd: root,
    env: { ...process.env, TEMP: temp, TMP: temp, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: dir } });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    const source = path.join(__dirname, 'mac-parity', 'good-enough', 'article.pdf');
    const before = fs.readFileSync(source);
    const pdf = before.toString('base64');
    await page.evaluate(base64 => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'Lab reading.pdf', { type: 'application/pdf' }));
      document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }, pdf);
    const cancel = page.getByRole('button', { name: 'Cancel Import', exact: true });
    await cancel.waitFor();
    const pid = await app.evaluate(() => process.pid);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    const children = await inspect(`
      $limit = [DateTime]::UtcNow.AddSeconds(42)
      do {
        $parser = Get-CimInstance Win32_Process -Filter \"Name = 'mineru-kit.exe'\" | Where-Object { $_.ParentProcessId -eq ${pid} -and $_.CommandLine -like '*${path.basename(temp)}*' } | Select-Object -First 1
        if ($parser) { $workers = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + $parser.ProcessId)) }
        if ($parser) {
          $owned = @(@($parser) + $workers | ForEach-Object { [PSCustomObject]@{ pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId; name = $_.Name; created = $_.CreationDate.ToUniversalTime().Ticks.ToString() } })
          ConvertTo-Json -InputObject $owned -Compress
          exit
        }
        Start-Sleep -Milliseconds 160
      } while ([DateTime]::UtcNow -lt $limit)
      Write-Output '[]'
    `);
    assert.ok(children.length >= 1, 'Expected a real running MinerU parser');
    console.log(JSON.stringify({ started: children }));
    await cancel.click();
    const predicate = children.map(p => {
      assert.ok(Number.isSafeInteger(p.pid) && p.pid > 0 && /^\d+$/.test(p.created));
      return "($_.ProcessId -eq " + p.pid + " -and $_.CreationDate.ToUniversalTime().Ticks.ToString() -eq '" + p.created + "')";
    }).join(' -or ');
    const live = () => inspect(`$list = @(Get-CimInstance Win32_Process -Filter '${children.map(p => 'ProcessId = ' + p.pid).join(' OR ')}' | Where-Object { ${predicate} } | ForEach-Object { [int]$_.ProcessId }); ConvertTo-Json -InputObject $list -Compress`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    let alive = await live();
    console.log(JSON.stringify({ aliveAfterCancel: alive }));
    if (!process.argv.includes('--observe')) {
      const limit = Date.now() + 4000;
      while (alive.length && Date.now() < limit) alive = await live();
      assert.deepEqual(alive, []);
    }
    await page.getByRole('heading', { name, exact: true }).waitFor({ timeout: 120000 });
    assert.deepEqual(store.list().map(paper => paper.id), [id]); assert.ok(store.paper(id).blocks[0].bookmark);
    assert.deepEqual(before, fs.readFileSync(source));
    console.log(JSON.stringify({ activePaperRestored: true, sourceBytesUnmodified: true }));
  } finally { await app.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
