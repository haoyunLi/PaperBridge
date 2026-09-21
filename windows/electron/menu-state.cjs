const MENU_STATE_KEYS = Object.freeze([
  'ready', 'hasPaper', 'busy', 'hasSelection', 'canUndo', 'canPrimaryTask',
  'canSummarize', 'canFullTranslation', 'canLookupSelection', 'canExport', 'checkingUpdates'
]);

function normalizeMenuState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid menu state.');
  const allowed = new Set(MENU_STATE_KEYS);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) || typeof value[key] !== 'boolean') throw new Error(`Invalid menu state field: ${key}`);
  }
  return Object.fromEntries(MENU_STATE_KEYS.map(key => [key, Object.hasOwn(value, key) && value[key] === true]));
}

function menuCommandState(value) {
  const state = normalizeMenuState(value);
  const paper = state.ready && state.hasPaper;
  const idlePaper = paper && !state.busy;
  return {
    openPdf: state.ready && !state.busy,
    export: idlePaper && state.canExport,
    library: state.ready,
    glossary: state.ready,
    summary: paper,
    find: paper,
    primaryTask: idlePaper && state.canPrimaryTask,
    generateSummary: idlePaper && state.canSummarize,
    generateFullTranslation: idlePaper && state.canFullTranslation,
    undo: paper && state.canUndo,
    translateSelection: paper && state.hasSelection && state.canLookupSelection,
    explainSelection: paper && state.hasSelection && state.canLookupSelection,
    highlightSelection: paper && state.hasSelection,
    inspector: state.ready,
    settings: state.ready,
    setup: state.ready,
    onboarding: state.ready,
    checkUpdates: state.ready && !state.checkingUpdates
  };
}

function applyMenuState(menu, value) {
  const commands = menuCommandState(value);
  for (const [command, enabled] of Object.entries(commands)) {
    const item = menu?.getMenuItemById(`command:${command}`);
    if (item) item.enabled = enabled;
  }
  return commands;
}

module.exports = { MENU_STATE_KEYS, normalizeMenuState, menuCommandState, applyMenuState };
