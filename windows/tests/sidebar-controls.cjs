// Match the macOS sidebar disclosure before using a loaded paper's import controls.
async function revealSidebarSource(page) {
  const details = page.locator('.document-details');
  if (await details.count() && await details.getAttribute('open') === null) {
    await details.locator('summary').click();
  }
}

module.exports = { revealSidebarSource };
