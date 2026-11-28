// Leave room for the native resize frame, which Windows rounds at fractional display scales.
function availableSize(work) {
  return { width: Math.max(1, work.width - 16), height: Math.max(1, work.height - 16) };
}

function minimumWindowSize(work) {
  const { width, height } = availableSize(work);
  return { minWidth: Math.min(980, width), minHeight: Math.min(620, height) };
}

function initialWindowBounds(work) {
  const available = availableSize(work);
  const width = Math.min(1320, available.width), height = Math.min(820, available.height);
  return { ...minimumWindowSize(work), width, height,
    x: work.x + Math.floor((work.width - width) / 2), y: work.y + Math.floor((work.height - height) / 2) };
}

function followDisplay(window, screen) {
  function fit(restoreBounds) {
    if (window.isDestroyed()) return;
    const bounds = window.getBounds(), work = screen.getDisplayMatching(bounds).workArea;
    const { minWidth, minHeight } = minimumWindowSize(work);
    const [oldWidth, oldHeight] = window.getMinimumSize();
    if (minWidth !== oldWidth || minHeight !== oldHeight) window.setMinimumSize(minWidth, minHeight);
    if (!restoreBounds || window.isMaximized() || window.isFullScreen() || window.isMinimized()) return;
    const available = availableSize(work);
    const width = bounds.width > work.width ? available.width : bounds.width;
    const height = bounds.height > work.height ? available.height : bounds.height;
    const x = Math.max(work.x, Math.min(bounds.x, work.x + work.width - width));
    const y = Math.max(work.y, Math.min(bounds.y, work.y + work.height - height));
    if (x !== bounds.x || y !== bounds.y || width !== bounds.width || height !== bounds.height) window.setBounds({ x, y, width, height });
  }
  const moved = () => fit(false);
  const changed = (_event, display, metrics) => {
    if (metrics.some(key => ['workArea', 'bounds', 'scaleFactor'].includes(key)) &&
        !window.isDestroyed() && screen.getDisplayMatching(window.getBounds()).id === display.id) fit(true);
  };
  const removed = () => fit(true);
  // Windows applies the monitor's non-client frame metrics after creating the native window.
  window.once('ready-to-show', () => fit(true));
  window.on('moved', moved);
  screen.on('display-metrics-changed', changed);
  screen.on('display-removed', removed);
  window.once('closed', () => {
    screen.removeListener('display-metrics-changed', changed);
    screen.removeListener('display-removed', removed);
  });
}

module.exports = { initialWindowBounds, followDisplay };
