const assert = require('node:assert/strict');

async function checkStartupRecovery(page, ready) {
  await ready.waitFor();
  const help = page.getByRole('main', { name: 'PaperBridge startup', includeHidden: true });
  assert.equal(await help.isVisible(), false);
  const entry = await page.locator('script[type="module"][src]').first().evaluate(script => script.src);
  const matchesEntry = url => url.href === entry;
  let interrupted = false;
  await page.route(matchesEntry, route => {
    interrupted = true;
    return route.abort();
  });
  try {
    await page.reload();
    assert.ok(interrupted, 'The production reader entry could not be loaded');
    await help.getByText('Trouble opening PaperBridge?', { exact: true }).press('Enter');
    assert.equal(await help.getByRole('link', { name: 'PaperBridge releases on GitHub' }).getAttribute('href'),
      'https://github.com/haoyunLi/PaperBridge/releases');
  } finally {
    await page.unroute(matchesEntry);
  }
  await help.getByRole('link', { name: 'Try again' }).click();
  await ready.waitFor();
  assert.equal(await help.isVisible(), false);
}

module.exports = { checkStartupRecovery };
