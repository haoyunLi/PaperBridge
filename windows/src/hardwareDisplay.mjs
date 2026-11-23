function formatMemory(bytes) {
  if (bytes < 1024 ** 2) return `${bytes.toLocaleString('en-US')} bytes`;
  if (bytes < 1024 ** 3) return `${Number((bytes / 1024 ** 2).toFixed(1))} MiB`;
  return `${Number((bytes / 1024 ** 3).toFixed(1))} GiB`;
}

export function describeModelMemory({ sizeVram, size }) {
  if (!Number.isSafeInteger(sizeVram) || sizeVram < 0) return 'GPU memory unreported';
  if (sizeVram === 0) return size > 0 ? 'CPU memory only' : '0 bytes in GPU memory';
  const memory = `${formatMemory(sizeVram)} in GPU memory`;
  if (sizeVram === size) return `GPU · ${memory}`;
  if (sizeVram < size) return `CPU + GPU · ${memory} of ${formatMemory(size)} total`;
  return memory;
}

export function describeAdapter(adapter) {
  const bytes = adapter.dedicatedMemoryBytes;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return `${adapter.name} (${adapter.vendor})`;
  const memory = bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} MiB` : `${Number((bytes / 1024 ** 3).toFixed(1))} GiB`;
  return `${adapter.name} (${adapter.vendor}, ${memory} dedicated)`;
}
