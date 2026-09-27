import { Readability } from '@mozilla/readability';

export type PageContent =
  | { kind: 'text'; title: string; url: string; text: string }
  | { kind: 'pdf'; title: string; url: string; base64: string }
  | { kind: 'video'; title: string; url: string };

/** Returns a canonical https://www.youtube.com/watch?v=ID URL, or null if not a YouTube video. */
export function youtubeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id: string | null = null;
    if (host === 'youtube.com' && u.pathname === '/watch') id = u.searchParams.get('v');
    else if (host === 'youtube.com' && /^\/(shorts|live|embed)\//.test(u.pathname)) id = u.pathname.split('/')[2] ?? null;
    else if (host === 'youtu.be') id = u.pathname.slice(1);
    return id && /^[\w-]{6,}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch {
    return null;
  }
}

const MAX_CHARS = 400_000; // ~100k tokens; plenty for Flash models

export async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error('No active tab found.');
  return tab as typeof tab & { id: number; url: string };
}

export async function readActivePage(): Promise<PageContent> {
  const tab = await getActiveTab();
  const url = tab.url;
  const title = tab.title ?? url;

  if (/^(chrome|edge|about|chrome-extension|moz-extension):/.test(url) || url.startsWith('https://chromewebstore.google.com')) {
    throw new Error("Browsers don't let extensions read this page. Try a normal website.");
  }

  const yt = youtubeUrl(url);
  if (yt) return { kind: 'video', title: title.replace(/ - YouTube$/, ''), url: yt };

  if (/\.pdf($|[?#])/i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download PDF (${res.status}).`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 18 * 1024 * 1024) throw new Error('PDF is larger than 18 MB; too big to send inline.');
    return { kind: 'pdf', title, url, base64: toBase64(buf) };
  }

  const [result] = await browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.documentElement.outerHTML,
  });
  const html = result?.result as string | undefined;
  if (!html) throw new Error('Could not read the page.');

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);
  const article = new Readability(doc).parse();
  let text = article?.textContent?.trim() || doc.body?.innerText?.trim() || doc.body?.textContent?.trim() || '';
  text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ');
  if (!text) throw new Error('This page has no readable text.');
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n\n[...truncated]';
  return { kind: 'text', title: article?.title || title, url, text };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
