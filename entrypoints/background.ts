export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    browser.contextMenus.create({
      id: 'gl-explain-selection',
      title: 'Explain with Gemini Lens',
      contexts: ['selection'],
    });
    if (reason === 'install') browser.runtime.openOptionsPage();
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'gl-explain-selection' || !info.selectionText) return;
    // Open first (must happen synchronously within the user gesture), then hand over the text.
    if (tab?.windowId !== undefined) browser.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    await browser.storage.session.set({
      pendingSelection: { text: info.selectionText, url: tab?.url ?? '', at: Date.now() },
    });
  });
});
