const crypto = require('node:crypto');

// Reveal the document disclosure before using a loaded paper's import controls.
async function revealSidebarSource(page) {
  await page.locator('.app').waitFor({ state: 'visible', timeout: 20000 });
  if (!await page.locator('.sidebar').isVisible()) {
    await page.getByRole('button', { name: 'Show Document Sidebar', exact: true }).click();
  }
  const details = page.locator('.document-details');
  if (await details.count() && await details.getAttribute('open') === null) {
    await details.locator(':scope > summary').click();
  }
}

async function openPasteText(page) {
  await page.locator('.app').waitFor({ state: 'visible', timeout: 20000 });
  const welcome = page.locator('.welcome').getByRole('button', { name: 'Paste Text', exact: true });
  // A narrow window can put the visible sidebar in front of Welcome. Use its
  // own disclosure instead of trying to click through the overlay.
  if (await page.locator('.sidebar').isVisible()) await revealSidebarSource(page);
  else if (await welcome.isVisible()) await welcome.click();
  else {
    await page.getByRole('button', { name: 'Show Document Sidebar', exact: true }).click();
    await revealSidebarSource(page);
  }
  const disclosure = page.locator('.sidebar-paste');
  await disclosure.waitFor({ state: 'visible' });
  if (await disclosure.getAttribute('open') === null) await disclosure.locator(':scope > summary').click();
  const textarea = disclosure.getByRole('textbox', { name: 'Paste text', exact: true });
  await textarea.waitFor({ state: 'visible' });
  return textarea;
}

async function loadPastedText(page, { view } = {}) {
  const disclosure = page.locator('.sidebar-paste');
  const text = await disclosure.getByRole('textbox', { name: 'Paste text', exact: true }).inputValue();
  const id = crypto.createHash('sha256').update(text.trim()).digest('hex');
  await disclosure.getByRole('button', { name: 'Load Text', exact: true }).click();
  await page.waitForFunction(id => {
    const host = document.querySelector('.main-scroll');
    return host?.dataset.readingPaperId === id && host.getAttribute('aria-busy') === 'false' && !document.querySelector('.task-progress');
  }, id, { timeout: 15000 });
  if (view) await openWorkspaceView(page, view);
  return id;
}

async function openWorkspaceView(page, view) {
  const button = page.locator('.header-tools .tabs').getByRole('button', { name: view, exact: true });
  await button.waitFor({ state: 'visible' });
  const close = page.getByRole('button', { name: 'Close Document Sidebar', exact: true });
  if (!await close.isVisible()) {
    try {
      await button.click({ timeout: 1500 });
      return;
    } catch {
      // Windows can finish applying the native window size or zoom during the click.
      // Recheck the visible drawer, then let Playwright perform its normal full wait.
    }
  }
  if (await close.isVisible()) await close.click();
  await button.click();
}

module.exports = { revealSidebarSource, openPasteText, loadPastedText, openWorkspaceView };
