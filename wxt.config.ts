import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Gemini Lens',
    description: 'Summarize web pages, PDFs and GitHub repos with your own Gemini API key.',
    permissions: ['storage', 'sidePanel', 'scripting', 'tabs', 'contextMenus'],
    // <all_urls> lets the side panel read whichever tab is active.
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Gemini Lens' },
  },
});
