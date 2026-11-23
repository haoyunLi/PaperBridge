const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const os = require('node:os');
const { detectMineruExecutable, mineru4Environment, mineruPython } = require('./mineru-discovery.cjs');
const run = promisify(execFile);

function vendorOf(name, pciVendor) {
  if (pciVendor === '10DE') return 'NVIDIA';
  if (pciVendor === '1002') return 'AMD';
  if (pciVendor === '8086') return 'Intel';
  if (/nvidia/i.test(name)) return 'NVIDIA';
  if (/amd|radeon/i.test(name)) return 'AMD';
  if (/intel/i.test(name)) return 'Intel';
  return 'Other';
}

// Win32_VideoController.AdapterRAM is a 32-bit field. Drivers that publish
// a 64-bit memory size can distinguish a large discrete card from an iGPU.
const adapterInventory = String.raw`
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Get-CimInstance Win32_VideoController | ForEach-Object {
  $dedicated = $null
  try {
    $driver = Get-ItemPropertyValue -LiteralPath ("HKLM:\SYSTEM\CurrentControlSet\Enum\" + $_.PNPDeviceID) -Name Driver -ErrorAction Stop
    $bytes = Get-ItemPropertyValue -LiteralPath ("HKLM:\SYSTEM\CurrentControlSet\Control\Class\" + $driver) -Name 'HardwareInformation.qwMemorySize' -ErrorAction Stop
    if ($bytes -is [long] -and $bytes -gt 0) { $dedicated = $bytes }
  } catch {}
  $pci = if ($_.PNPDeviceID -match '^PCI\\VEN_([0-9A-F]{4})') { $Matches[1].ToUpperInvariant() }
  [pscustomobject]@{ Name = $_.Name; VendorID = $pci; DriverVersion = $_.DriverVersion; AdapterRAM = $_.AdapterRAM; DedicatedBytes = $dedicated }
} | ConvertTo-Json -Compress`;

function nvidiaDevices(output) {
  return output.trim().split(/\r?\n/).flatMap(line => {
    const fields = line.split(',').map(field => field.trim());
    const mib = Number(fields.pop());
    const driver = fields.pop();
    const name = fields.join(', ').replace(/^"|"$/g, '');
    if (!name || !/^\d+(?:\.\d+)+$/.test(driver)) return [];
    return [{ name, driver, memoryMiB: Number.isSafeInteger(mib) && mib > 0 ? mib : null }];
  });
}

function mergeAdapterInventory(controllers, devices) {
  const adapters = controllers.filter(item => item?.Name).map(item => {
    const dedicatedMemoryBytes = Number.isSafeInteger(item.DedicatedBytes) && item.DedicatedBytes > 0 ? item.DedicatedBytes : null;
    return { name: item.Name, vendor: vendorOf(item.Name, item.VendorID), driver: item.DriverVersion || '',
      dedicatedMemoryBytes, memoryBytes: dedicatedMemoryBytes || item.AdapterRAM || null };
  });
  const matched = new Set();
  const comparableName = name => name.toLowerCase().replace(/^nvidia\s+/, '');
  for (const device of devices || []) {
    const adapter = adapters.find(item => !matched.has(item) && comparableName(item.name) === comparableName(device.name));
    const bytes = device.memoryMiB == null ? null : device.memoryMiB * 1024 ** 2;
    if (adapter) {
      matched.add(adapter);
      adapter.vendor = 'NVIDIA';
      if (!adapter.driver) adapter.driver = device.driver;
      if (bytes) { adapter.dedicatedMemoryBytes = bytes; adapter.memoryBytes = bytes; }
    } else {
      const reported = { name: device.name, driver: device.driver, vendor: 'NVIDIA', dedicatedMemoryBytes: bytes, memoryBytes: bytes };
      adapters.push(reported);
      matched.add(reported);
    }
  }
  return adapters;
}

async function graphicsStatus() {
  let controllers = [];
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', adapterInventory], { timeout: 8000, windowsHide: true });
    const values = JSON.parse(stdout.trim());
    controllers = Array.isArray(values) ? values : [values];
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
      const devices = nvidiaDevices(stdout);
      if (devices.length) { cudaDriver = devices; smiPath = candidate; break; }
    } catch { /* Try the next standard NVIDIA driver location. */ }
  }
  if (cudaDriver?.length) {
    try {
      const { stdout } = await run(smiPath, [], { timeout: 5000, windowsHide: true });
      cudaVersion = stdout.match(/CUDA Version:\s*(\d+\.\d+)/i)?.[1] || null;
    } catch { /* Driver inventory still works when the full report is unavailable. */ }
  }
  return { adapters: mergeAdapterInventory(controllers, cudaDriver), cudaDriver, cudaVersion,
    systemMemoryBytes: os.totalmem(), detectedAt: new Date().toISOString() };
}

async function mineruRuntime(executable, toolsRoot, { found, signal, backend = 'auto' } = {}) {
  const detected = found || await detectMineruExecutable(executable, toolsRoot);
  if (!detected.compatible) return { checked: false, reason: detected.reason };
  if (detected.kitExecutable) {
    try {
      const { stdout } = await run(detected.kitExecutable, ['hardware', 'info', '--json'], {
        timeout: 30000, windowsHide: true, signal, env: mineru4Environment(toolsRoot, backend)
      });
      const onnx = JSON.parse(stdout).runtimes?.find(runtime => runtime.name === 'onnx');
      if (onnx?.status !== 'ok') return { checked: false, engine: 'onnx', reason: 'MinerU could not verify its ONNX runtime.' };
      const device = onnx.data?.selected_device;
      const adapter = device?.adapter?.name;
      const directml = device?.device === 'gpu' && device.backend === 'dml';
      const mode = backend === 'pipeline' ? 'ONNX compatibility mode uses' : 'ONNX Auto selects';
      let description = 'ONNX runtime available; execution device unreported';
      if (device?.device === 'cpu') description = `${mode} CPU`;
      if (device?.device === 'gpu') description = `${mode} ${directml ? 'DirectML' : 'GPU'}${adapter ? ` on ${adapter}` : ''}`;
      return { checked: true, engine: 'onnx', directml, devices: directml && adapter ? [adapter] : [], description };
    } catch (error) { return { checked: false, engine: 'onnx', reason: `Cannot check MinerU ONNX: ${error.message.slice(0, 140)}` }; }
  }
  const python = mineruPython(detected.executable);
  if (!python) return { checked: false, reason: 'Could not identify the Python environment that owns this MinerU command. Check acceleration in that environment manually.' };
  try {
    const script = `
import importlib.util, json, sys
def report_failure(message):
    owns_package = importlib.util.find_spec("mineru") is not None
    print(json.dumps({"checked": False, "unusable": owns_package, "reason": message[:240]}))
    sys.exit(0)
try:
    import torch
except Exception as error:
    report_failure("Cannot load MinerU PyTorch: " + str(error))
ready = False
reason = ""
devices = []
try:
    if torch.cuda.is_available():
        torch.ones(1, device="cuda").add_(1)
        torch.cuda.synchronize()
        ready = True
except Exception as error:
    reason = str(error)[:180] or type(error).__name__
if ready:
    try:
        devices = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
    except Exception:
        pass  # Optional device names do not invalidate a completed CUDA operation.
else:
    try:
        torch.ones(1, device="cpu").add_(1)
    except Exception as error:
        report_failure("MinerU PyTorch could not run its CPU operation: " + str(error))
print(json.dumps({"torch": torch.__version__, "cuda": ready, "devices": devices, "reason": reason}))
`;
    const { stdout } = await run(python, ['-c', script], { timeout: 30000, windowsHide: true, signal });
    const runtime = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
    if (runtime.checked === false) return runtime;
    // Some drivers enumerate a CUDA device that cannot execute kernels from this PyTorch build.
    if (!runtime.cuda && runtime.reason) return { ...runtime, checked: true, cpuFallback: true,
      description: 'CUDA could not execute the test operation. PDFs will use the CPU pipeline' };
    return { checked: true, ...runtime };
  } catch (error) { return { checked: false, reason: `Cannot verify MinerU PyTorch CUDA: ${error.message.slice(0, 140)}` }; }
}

module.exports = { graphicsStatus, mineruRuntime, vendorOf, nvidiaDevices, mergeAdapterInventory };
