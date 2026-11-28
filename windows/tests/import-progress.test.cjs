const test = require('node:test');
const assert = require('node:assert/strict');

test('MinerU import logs map to stable user-facing stages and stage-local counts', async () => {
  const { mineruImportStage } = await import('../src/importProgress.mjs');
  assert.equal(mineruImportStage('layout detection 2 / 8'), 'Analyzing page layout · 2 of 8');
  assert.equal(mineruImportStage('formula recognition 3/4'), 'Recognizing formulas · 3 of 4');
  assert.equal(mineruImportStage('OCR text recognition 1 / 9'), 'Recognizing text · 1 of 9');
  assert.equal(mineruImportStage('unknown backend message'), 'MinerU is processing the PDF');
});
