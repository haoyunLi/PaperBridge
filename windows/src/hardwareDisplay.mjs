export function describeAdapter(adapter) {
  const bytes = adapter.dedicatedMemoryBytes;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return `${adapter.name} (${adapter.vendor})`;
  const memory = bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} MiB` : `${Number((bytes / 1024 ** 3).toFixed(1))} GiB`;
  return `${adapter.name} (${adapter.vendor}, ${memory} dedicated)`;
}
