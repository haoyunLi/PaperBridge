const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { initialWindowBounds, followDisplay } = require('../electron/window-layout.cjs');

test('startup uses the available Windows desktop, including a taskbar or a negative origin', () => {
  assert.deepEqual(initialWindowBounds({ x: -1920, y: 35, width: 1920, height: 1045 }),
    { x: -1620, y: 147, width: 1320, height: 820, minWidth: 980, minHeight: 620 });
  assert.deepEqual(initialWindowBounds({ x: 0, y: 13, width: 854, height: 467 }),
    { x: 8, y: 21, width: 838, height: 451, minWidth: 838, minHeight: 451 });
});

test('display changes recover the window, ordinary dragging and maximized windows keep their position', () => {
  const screen = new EventEmitter(), window = new EventEmitter();
  const workArea = { x: 20, y: 8, width: 770, height: 495 };
  const display = { id: 2, workArea };
  let bounds = { x: -1300, y: -90, width: 1000, height: 620 }, minimum = [980,620], maximized = false;
  screen.getDisplayMatching = () => display;
  Object.assign(window, { isDestroyed: () => false, isMaximized: () => maximized,
    isFullScreen: () => false, isMinimized: () => false, getBounds: () => bounds,
    getMinimumSize: () => minimum, setMinimumSize: (...value) => { minimum = value; },
    setBounds: value => { bounds = value; } });
  followDisplay(window, screen);
  window.emit('moved');
  assert.deepEqual(minimum, [754,479]); assert.equal(bounds.x, -1300);
  maximized = true;
  screen.emit('display-metrics-changed', {}, display, ['scaleFactor']);
  assert.equal(bounds.x, -1300);
  maximized = false;
  screen.emit('display-removed');
  assert.deepEqual(bounds, { x: 20, y: 8, width: 754, height: 479 });
  window.emit('closed');
  assert.equal(screen.listenerCount('display-metrics-changed'), 0);
  assert.equal(screen.listenerCount('display-removed'), 0);
});
