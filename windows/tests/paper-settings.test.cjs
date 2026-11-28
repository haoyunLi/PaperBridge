const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults } = require('../electron/storage.cjs');

const paperSettings = import('../src/paperSettings.mjs');

test('paper snapshot contains the Mac task settings, excluding global appearance and update preference', async () => {
  const { snapshotPaperSettings, TASK_SETTING_KEYS } = await paperSettings;
  const settings = Object.freeze({
    ...defaults,
    sourceLanguage: 'Japanese',
    targetLanguage: 'English',
    translationModel: 'translation:a',
    fontSize: 23,
    lineHeight: 2,
    readingWidth: 720,
    autoCheckUpdates: false,
    futureGlobalSetting: 'keep global'
  });
  const snapshot = snapshotPaperSettings(settings);
  assert.deepEqual(Object.keys(snapshot), TASK_SETTING_KEYS);
  assert.equal(snapshot.sourceLanguage, 'Japanese');
  assert.equal(snapshot.translationModel, 'translation:a');
  for (const key of ['fontSize', 'lineHeight', 'readingWidth', 'autoCheckUpdates', 'futureGlobalSetting']) {
    assert.equal(Object.hasOwn(snapshot, key), false);
  }
});

test('restoring a paper changes task settings while retaining current global preferences', async () => {
  const { restorePaperSettings, snapshotPaperSettings } = await paperSettings;
  const paperA = Object.freeze(snapshotPaperSettings({ ...defaults, sourceLanguage: 'English', targetLanguage: 'Simplified Chinese', translationModel: 'translation:a' }));
  const paperB = Object.freeze(snapshotPaperSettings({ ...defaults, sourceLanguage: 'Japanese', targetLanguage: 'English', translationModel: 'translation:b' }));
  const current = Object.freeze({ ...defaults, fontSize: 22, lineHeight: 1.9, readingWidth: 700, autoCheckUpdates: false });
  const onB = restorePaperSettings(current, paperB);
  const backOnA = restorePaperSettings(onB, paperA);
  assert.equal(onB.sourceLanguage, 'Japanese');
  assert.equal(onB.translationModel, 'translation:b');
  assert.equal(backOnA.sourceLanguage, 'English');
  assert.equal(backOnA.targetLanguage, 'Simplified Chinese');
  assert.equal(backOnA.translationModel, 'translation:a');
  for (const result of [onB, backOnA]) {
    assert.equal(result.fontSize, 22);
    assert.equal(result.lineHeight, 1.9);
    assert.equal(result.readingWidth, 700);
    assert.equal(result.autoCheckUpdates, false);
  }
  assert.equal(current.sourceLanguage, 'English');
  assert.equal(paperB.translationModel, 'translation:b');
});

test('legacy and partial paper settings inherit current values and ignore invalid or global fields', async () => {
  const { restorePaperSettings, snapshotPaperSettings } = await paperSettings;
  const current = Object.freeze({ ...defaults, sourceLanguage: 'French', fontSize: 20, autoCheckUpdates: false });
  assert.deepEqual(restorePaperSettings(current, undefined), current);
  assert.deepEqual(restorePaperSettings(current, null), current);
  assert.deepEqual(restorePaperSettings(current, []), current);
  assert.deepEqual(snapshotPaperSettings(null), {});
  const restored = restorePaperSettings(current, {
    targetLanguage: 'German',
    sourceLanguage: '',
    maxParagraphChars: -1,
    mineruBackend: 'unknown',
    mineruExecutable: '',
    fontSize: 99,
    autoCheckUpdates: true,
    unexpected: 'ignored'
  });
  assert.equal(restored.sourceLanguage, 'French');
  assert.equal(restored.targetLanguage, 'German');
  assert.equal(restored.maxParagraphChars, defaults.maxParagraphChars);
  assert.equal(restored.mineruBackend, defaults.mineruBackend);
  assert.equal(restored.mineruExecutable, '');
  assert.equal(restored.fontSize, 20);
  assert.equal(restored.autoCheckUpdates, false);
  assert.equal(Object.hasOwn(restored, 'unexpected'), false);
});
