// Run explicitly with npm run test:live after installing the configured Ollama model.
// This test uses a real local model and keeps all PaperBridge data in test-artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'test-artifacts');
const model = process.env.PAPERBRIDGE_LIVE_MODEL || 'translategemma:4b';
const baseURL = process.env.PAPERBRIDGE_LIVE_OLLAMA || 'http://127.0.0.1:11434';

async function json(endpoint, body) {
  const response = await fetch(new URL(endpoint, baseURL), {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(180000)
  });
  if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function run() {
  const prompts = await import('../src/prompts.mjs');
  const installed = await json('/api/tags');
  assert.ok(installed.models?.some(item => item.model === model || item.name === model), `Install ${model} first`);
  const samples = [
    {
      name: 'methods and statistics',
      text: 'In a randomized controlled study of 240 patients, the treatment reduced systolic blood pressure by 8.4 mmHg (95% confidence interval, 5.2–11.6 mmHg; p < 0.01) compared with placebo [12].',
      source: 'English', target: 'Simplified Chinese'
    },
    {
      name: 'scientific terminology',
      text: 'The single-cell RNA sequencing analysis identified a distinct population of CD8+ T cells. We did not infer a causal mechanism from the observed association.',
      source: 'English', target: 'Simplified Chinese'
    },
    {
      name: 'reverse direction',
      text: '该研究报告了相关性，但样本量不足以证明因果关系。',
      source: 'Simplified Chinese', target: 'English'
    },
    {
      name: 'protected Markdown',
      text: '## Results\n\nThe estimated effect was $\\beta=0.42$ (Figure 1). ![Figure 1](figures/flow.png) The model retained the original units [12].',
      source: 'English', target: 'Simplified Chinese', markdown: true
    }
  ];
  const results = [];
  for (const sample of samples) {
    const started = performance.now();
    const protectedBlock = sample.markdown ? prompts.protectMarkdown(sample.text) : null;
    const data = await json('/api/generate', {
      model,
      system: prompts.translationSystem(sample.target),
      prompt: sample.markdown
        ? prompts.markdownTranslationPrompt(protectedBlock.text, sample.source, sample.target)
        : prompts.translationPrompt(sample.text, sample.source, sample.target),
      stream: false,
      options: { temperature: 0.1 }
    });
    const result = {
      name: sample.name,
      source: sample.text,
      translation: sample.markdown ? prompts.restoreMarkdown(data.response?.trim() || '', protectedBlock.tokens) : data.response?.trim(),
      wallSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      generatedTokens: data.eval_count,
      tokensPerSecond: data.eval_count && data.eval_duration ? Number((data.eval_count / (data.eval_duration / 1e9)).toFixed(1)) : null,
      loadSeconds: data.load_duration ? Number((data.load_duration / 1e9).toFixed(2)) : null
    };
    assert.ok(result.translation, `${sample.name}: empty translation`);
    assert.ok(sample.target === 'English' ? /[A-Za-z]/.test(result.translation) : /[\u3400-\u9fff]/.test(result.translation), `${sample.name}: wrong output language`);
    if (sample.markdown) {
      assert.ok(result.translation.includes('$\\beta=0.42$'), 'Formula changed in Markdown translation');
      assert.ok(result.translation.includes('![Figure 1](figures/flow.png)'), 'Image path changed in Markdown translation');
    }
    results.push(result);
    console.log(`${result.name}: ${result.wallSeconds}s, ${result.tokensPerSecond} tokens/s\n${result.translation}\n`);
  }
  const loaded = await json('/api/ps');
  const active = loaded.models?.find(item => item.name === model || item.model === model);
  assert.ok(active, 'Ollama did not report the test model as loaded');
  const gpu = { model, sizeBytes: active.size, vramBytes: active.size_vram, vramFraction: Number(((active.size_vram || 0) / active.size).toFixed(3)) };
  console.log(`Loaded model VRAM: ${(gpu.vramBytes / 1024 ** 3).toFixed(2)} GiB / ${(gpu.sizeBytes / 1024 ** 3).toFixed(2)} GiB`);

  fs.mkdirSync(artifacts, { recursive: true });
  const workspace = path.join(artifacts, 'live-workspace');
  assert.ok(path.resolve(workspace).startsWith(path.resolve(artifacts) + path.sep));
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'settings.json'), JSON.stringify({
    ollamaBaseURL: baseURL, translationModel: model, summaryModel: model,
    explainModel: model, quickLookupModel: model, autoCheckUpdates: false, onboardingCompletedVersion: 1
  }));
  const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  let uiTranslation = '';
  let uiExplanation = '';
  let uiSummary = '';
  let uiFullTranslation = '';
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1320, height: 820 });
    await page.getByRole('button', { name: 'Try a Practice Paper' }).first().click();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    await page.locator('.block').nth(1).waitFor();
    await page.locator('.block').nth(1).locator('button[title="Translate or retry block"]').click();
    await page.locator('.block').nth(1).locator('.translation-text.done').waitFor({ timeout: 180000 });
    uiTranslation = await page.locator('.block').nth(1).locator('.translation-text.done').innerText();
    assert.match(uiTranslation, /[\u3400-\u9fff]/);
    await page.getByLabel('Reading mode').selectOption('source');
    assert.equal(await page.locator('.block').nth(1).locator('.translation-text').isVisible(), false);
    await page.getByLabel('Reading mode').selectOption('translation');
    assert.equal(await page.locator('.block').nth(1).locator('.source-text').isVisible(), false);
    await page.getByLabel('Reading mode').selectOption('bilingual');
    await page.screenshot({ path: path.join(artifacts, 'live-amd-reader.png') });
    console.log(`PaperBridge Reader translation: ${uiTranslation}`);
    await page.locator('.block').nth(1).locator('button[title="Explain full paragraph"]').click();
    await page.locator('.paragraph-explanation p').waitFor({ timeout: 60000 });
    uiExplanation = await page.locator('.paragraph-explanation p').innerText();
    assert.ok(uiExplanation.length > 20);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Generate summary' }).click();
    await page.locator('.summary-card').first().waitFor({ timeout: 60000 });
    uiSummary = await page.locator('.summary-card').first().innerText();
    assert.ok(uiSummary.length > 40);
    console.log(`PaperBridge summary claims: ${await page.locator('.evidence-claim').count()}`);
    await page.getByRole('button', { name: 'Full Translation', exact: true }).click();
    await page.getByRole('button', { name: 'Translate full paper' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Connected full-paper translation saved.'), null, { timeout: 120000 });
    await page.locator('.content-column .document-preview').waitFor();
    uiFullTranslation = await page.locator('.content-column .document-preview').innerText();
    assert.match(uiFullTranslation, /[\u3400-\u9fff]/);
  } finally { await app.close(); }

  const saved = fs.readdirSync(path.join(workspace, 'papers')).map(name => JSON.parse(fs.readFileSync(path.join(workspace, 'papers', name), 'utf8')));
  assert.ok(saved.some(paper => paper.blocks.some(block => block.status === 'ok' && block.translation?.includes(uiTranslation.slice(0, 10)))), 'UI translation was not saved');
  const paper = saved.find(item => item.summary?.claims?.length);
  const verifiedSources = paper?.summary?.claims?.flatMap(claim => claim.sources || []) || [];
  assert.ok(verifiedSources.length > 0, 'The real model summary has no validated source quotations');
  for (const source of verifiedSources) assert.ok(paper.blocks.find(block => block.id === source.paragraphID)?.text.includes(source.quote), 'Summary quote is not in the source paragraph');
  const restarted = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, NODE_ENV: 'production', PAPERBRIDGE_WORKSPACE: workspace }, timeout: 30000 });
  try {
    const page = await restarted.firstWindow();
    await page.locator('.content-column .document-preview').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.content-column .document-preview').innerText(), uiFullTranslation);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.locator('.summary-card').first().waitFor();
    await page.getByRole('button', { name: 'Reader', exact: true }).click();
    assert.equal(await page.locator('.block').nth(1).locator('.translation-text.done').innerText(), uiTranslation);
  } finally { await restarted.close(); }
  const report = { at: new Date().toISOString(), gpu, samples: results, uiTranslation, uiExplanation, uiSummary, uiFullTranslation, verifiedSourceCount: verifiedSources.length };
  fs.writeFileSync(path.join(artifacts, 'live-local-report.json'), JSON.stringify(report, null, 2));
  console.log(`Live test report: ${path.join(artifacts, 'live-local-report.json')}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
