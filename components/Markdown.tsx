import { createContext, useContext, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { repairMermaid } from '@/lib/mermaid-repair';
import { linkForPath, type RepoLinks } from '@/lib/github';
import { downloadBlob, downloadText, slug, svgToPng } from '@/lib/export';

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;
function loadMermaid() {
  mermaidReady ??= import('mermaid').then((m) => {
    m.default.initialize({
      startOnLoad: false,
      theme: isDark() ? 'dark' : 'default',
      securityLevel: 'strict',
      // Plain SVG text (no <foreignObject>) so diagrams can be exported to PNG.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    return m.default;
  });
  return mermaidReady;
}

/** Repo info for the current answer, used to make diagram nodes clickable. */
export const RepoLinksContext = createContext<RepoLinks | null>(null);

const CLICK_LINE = /^\s*click\s+([\w-]+)\s+(?:href\s+)?"([^"]+)"/;

/** Splits `click Node "path"` lines out of the diagram (we handle clicks ourselves). */
function extractClicks(code: string) {
  const clicks = new Map<string, string>();
  const body = code
    .split('\n')
    .filter((line) => {
      const m = CLICK_LINE.exec(line);
      if (m) clicks.set(m[1]!, m[2]!);
      return !/^\s*click\s/.test(line);
    })
    .join('\n');
  return { body, clicks };
}

let renderCount = 0;

async function renderMermaid(code: string): Promise<string> {
  const m = await loadMermaid();
  for (const candidate of [code, repairMermaid(code)]) {
    // parse() first so a failed attempt doesn't leave an error graphic in the page
    if (await m.parse(candidate, { suppressErrors: true })) {
      const { svg } = await m.render(`mermaid-${++renderCount}`, candidate);
      return svg;
    }
  }
  throw new Error('Invalid Mermaid syntax');
}

function Mermaid({ code, streaming }: { code: string; streaming: boolean }) {
  const links = useContext(RepoLinksContext);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(false);
  const [linked, setLinked] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const { body, clicks } = extractClicks(code);

  useEffect(() => {
    if (streaming) return; // wait until the block is complete
    let cancelled = false;
    renderMermaid(body)
      .then((svg) => {
        if (!cancelled) (setSvg(svg), setError(false));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [body, streaming]);

  // Make nodes clickable: only for paths that really exist in the repo.
  useEffect(() => {
    const el = box.current;
    if (!svg || !el || !links) return;
    let count = 0;
    el.querySelectorAll<SVGGElement>('g.node').forEach((node) => {
      const nodeId = /flowchart-(.+)-\d+$/.exec(node.id)?.[1];
      const path = nodeId ? clicks.get(nodeId) : undefined;
      const url = path ? linkForPath(links, path) : null;
      if (!url) return;
      count++;
      node.classList.add('linked');
      node.setAttribute('role', 'link');
      node.setAttribute('tabindex', '0');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `Open ${path} on GitHub`;
      node.prepend(title);
      const open = () => browser.tabs.create({ url });
      node.addEventListener('click', open);
      node.addEventListener('keydown', (e) => e.key === 'Enter' && open());
    });
    setLinked(count);
  }, [svg, links, clicks.size]); // eslint-disable-line react-hooks/exhaustive-deps

  if (svg && !error) {
    const png = async () => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
      downloadBlob(await svgToPng(svg, bg), 'flow.png');
    };
    return (
      <figure className="diagram">
        <div ref={box} dangerouslySetInnerHTML={{ __html: svg }} />
        <figcaption className="actions">
          {linked > 0 && <span className="muted small">Click a box to open the file · </span>}
          <button className="link" onClick={() => downloadText(svg, 'flow.svg', 'image/svg+xml')}>SVG</button>
          <button className="link" onClick={png}>PNG</button>
          <button className="link" onClick={() => navigator.clipboard.writeText(code)}>Copy Mermaid</button>
        </figcaption>
      </figure>
    );
  }
  return (
    <pre className={error ? 'diagram-error' : ''}>
      {error && <div className="muted">Couldn't render diagram. Mermaid source:</div>}
      <code>{code}</code>
    </pre>
  );
}

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          pre: ({ children }) => <>{children}</>,
          code({ node: _n, className, children, ...rest }) {
            const lang = /language-(\w+)/.exec(className ?? '')?.[1];
            const code = String(children);
            const isBlock = !!lang || code.includes('\n');
            if (lang === 'mermaid') return <Mermaid code={code.replace(/\n$/, '')} streaming={streaming} />;
            if (!isBlock) return <code {...rest}>{children}</code>;
            return (
              <pre>
                <code className={className} {...rest}>{code.replace(/\n$/, '')}</code>
              </pre>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Copy / download buttons shown under a finished answer. */
export function AnswerActions({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => downloadText(`# ${title}\n\n${text}\n`, `${slug(title)}.md`);
  return (
    <div className="actions">
      <button className="link" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      <button className="link" onClick={download}>Download .md</button>
    </div>
  );
}
