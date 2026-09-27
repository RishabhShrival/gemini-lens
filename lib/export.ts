/** Triggers a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type = 'text/markdown') {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

/** "Analyze repo · acme/demo" -> "analyze-repo-acme-demo" */
export function slug(s: string, fallback = 'gemini-lens'): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return out || fallback;
}

/** Renders a Mermaid SVG string to a PNG blob at 2x resolution. */
export async function svgToPng(svg: string, background: string): Promise<Blob> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.documentElement;
  const [, , w = 800, h = 600] = (el.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  el.setAttribute('width', String(w));
  el.setAttribute('height', String(h));
  el.removeAttribute('style'); // drops max-width so the image isn't squashed
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(el));

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not load diagram image'));
    img.src = src;
  });

  const scale = 2;
  const pad = 16;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + pad * 2) * scale);
  canvas.height = Math.ceil((h + pad * 2) * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, pad, pad, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'),
  );
}
