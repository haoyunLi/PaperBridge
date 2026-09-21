const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { detectMineruExecutable } = require('./mineru-discovery.cjs');
const run = promisify(execFile);

function vendorOf(name) {
  if (/nvidia/i.test(name)) return 'NVIDIA';
  if (/amd|radeon/i.test(name)) return 'AMD';
  if (/intel/i.test(name)) return 'Intel';
  return 'Other';
}

async function graphicsStatus() {
  let adapters = [];
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress'], { timeout: 8000, windowsHide: true });
    const values = JSON.parse(stdout.trim());
    adapters = (Array.isArray(values) ? values : [values]).filter(item => item?.Name).map(item => ({ name: item.Name, vendor: vendorOf(item.Name), driver: item.DriverVersion || '', memoryBytes: item.AdapterRAM || null }));
  } catch { /* Windows GPU inventory can be unavailable in VMs and restricted sessions. */ }
  let cudaDriver = null;
  let cudaVersion = null;
  let smiPath = '';
  const candidates = ['nvidia-smi',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe')];
  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate, ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true });
      cudaDriver = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
        const [name, driver, mib] = line.split(',').map(value => value.trim());
        return { name, driver, memoryMiB: Number(mib) || null };
      });
      smiPath = candidate;
      break;
    } catch { /* Try the next standard NVIDIA driver location. */ }
  }
  if (cudaDriver?.length) {
    try {
      const { stdout } = await run(smiPath, [], { timeout: 5000, windowsHide: true });
      cudaVersion = stdout.match(/CUDA Version:\s*(\d+\.\d+)/i)?.[1] || null;
    } catch { /* Driver inventory still works when the full report is unavailable. */ }
  }
  return { adapters, cudaDriver, cudaVersion, systemMemoryBytes: os.totalmem(), detectedAt: new Date().toISOString() };
}

async function mineruRuntime(executable, toolsRoot) {
  let command = String(executable || '').trim();
  if (!command) {
    const detected = await detectMineruExecutable('', toolsRoot);
    if (!detected.compatible) return { checked: false, reason: detected.reason };
    command = detected.executable;
  }
  const resolved = fs.existsSync(command) ? command : '';
  if (!resolved) return { checked: false, reason: 'Enter the full path to MinerU to check its Python environment.' };
  const python = path.join(path.dirname(resolved), 'python.exe');
  if (!fs.existsSync(python)) return { checked: false, reason: 'Could not identify the Python interpreter beside MinerU. Check CUDA in the same environment manually.' };
  try {
    const script = [
      'import json, torch',
      'ready = torch.cuda.is_available()',
      'reason = ""',
      'if ready:',
      '    try:',
      '        torch.ones(1, device="cuda").add_(1)',
      '        torch.cuda.synchronize()',
      '    except Exception as error:',
      '        ready = False',
      '        reason = str(error)[:180]',
      'print(json.dumps({"torch":torch.__version__,"cuda":ready,"devices":[torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())],"reason":reason}))'
    ].join('\n');
    const { stdout } = await run(python, ['-c', script], { timeout: 30000, windowsHide: true });
    return { checked: true, ...JSON.parse(stdout.trim().split(/\r?\n/).at(-1)) };
  } catch (error) { return { checked: false, reason: `Cannot verify MinerU PyTorch CUDA: ${error.message.slice(0, 140)}` }; }
}

module.exports = { graphicsStatus, mineruRuntime, vendorOf };
