import { useCallback, useEffect, useRef, useState } from 'react';
import { AnswerActions, Markdown, RepoLinksContext } from '@/components/Markdown';
import { streamChat, MissingKeyError, type Content } from '@/lib/gemini';
import { readActivePage, youtubeUrl, type PageContent } from '@/lib/page';
import {
  buildFileContext, buildIssueContext, buildPrContext, buildRepoDigest, parseGitHubPage, parseRepo,
  type GitHubContext, type RepoLinks, type RepoRef,
} from '@/lib/github';
import {
  FILE_PROMPT, ISSUE_PROMPT, linkHint, pagePrompt, PR_PROMPT, REPO_PROMPT, SELECTION_PROMPT, STYLE_LABELS,
  videoPrompt, type SummaryStyle,
} from '@/lib/prompts';
import { getSettings } from '@/lib/settings';

interface Turn {
  role: 'user' | 'model';
  text: string;
  error?: boolean;
  links?: RepoLinks | null; // lets diagram nodes link to files in the analyzed repo
}

/** Builds the Gemini message for a page, PDF or YouTube video. */
function pageMessage(page: PageContent, prompt: string, wrapText = (p: string, t: string) => `${p}\n\n---\n${t}`): Content {
  if (page.kind === 'pdf')
    return { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'application/pdf', data: page.base64 } }] };
  if (page.kind === 'video') return { role: 'user', parts: [{ fileData: { fileUri: page.url } }, { text: prompt }] };
  return { role: 'user', parts: [{ text: wrapText(prompt, page.text) }] };
}

type Tab = 'page' | 'repo';

export default function App() {
  const [tab, setTab] = useState<Tab>('page');
  const [style, setStyle] = useState<SummaryStyle>('bullets');
  const [repoInput, setRepoInput] = useState('');
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState(true);
  const [model, setModel] = useState('');
  const [activeUrl, setActiveUrl] = useState('');

  const history = useRef<Content[]>([]); // what we actually send to Gemini
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const sessionLinks = useRef<RepoLinks | null>(null); // repo of the current conversation, if any

  // Settings (and keep in sync if changed in the options page)
  useEffect(() => {
    const load = () => getSettings().then((s) => (setHasKey(!!s.apiKey), setModel(s.model)));
    load();
    browser.storage.local.onChanged.addListener(load);
    return () => browser.storage.local.onChanged.removeListener(load);
  }, []);

  // Pre-fill the repo box and switch tab when the user is on GitHub.
  useEffect(() => {
    const sync = async () => {
      const [t] = await browser.tabs.query({ active: true, currentWindow: true });
      setActiveUrl(t?.url ?? '');
      const ref = t?.url ? parseRepo(t.url) : null;
      if (ref && t?.url?.includes('github.com')) {
        setRepoInput(`${ref.owner}/${ref.repo}`);
        setTab((cur) => (history.current.length ? cur : 'repo'));
      }
    };
    sync();
    const onUpdated = (_id: number, info: { url?: string }) => info.url && sync();
    browser.tabs.onActivated.addListener(sync);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(sync);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  useEffect(() => {
    // Braces matter: newer Chrome returns a Promise from scrollIntoView, and React
    // would try to call that as the effect's cleanup function.
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  /** Sends `content` (appending to history unless `fresh`) and streams the reply. */
  const run = useCallback(async (label: string, build: () => Promise<Content>, fresh: boolean) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    if (fresh) (history.current = [], (sessionLinks.current = null));
    setTurns((t) => [...(fresh ? [] : t), { role: 'user', text: label }, { role: 'model', text: '' }]);

    const setReply = (text: string, error = false) =>
      setTurns((t) => [...t.slice(0, -1), { role: 'model', text, error, links: sessionLinks.current }]);

    try {
      const userContent = await build();
      setStatus('Thinking…');
      const contents = [...history.current, userContent];
      const reply = await streamChat(
        contents,
        (full) => (setStatus(''), setReply(full)),
        ctrl.signal,
        (n) => setStatus(`Gemini is busy, retrying (${n}/2)…`),
      );
      history.current = [...contents, { role: 'model', parts: [{ text: reply }] }];
    } catch (e) {
      if (ctrl.signal.aborted) {
        setTurns((t) => {
          const last = t[t.length - 1];
          return [...t.slice(0, -1), { ...last, role: 'model', text: (last?.text || '') + '\n\n_Stopped._' }];
        });
      } else {
        const msg = e instanceof MissingKeyError ? e.message : friendlyError(e);
        setReply(msg, true);
      }
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, []);

  const isVideo = !!youtubeUrl(activeUrl);
  const ghPage = parseGitHubPage(activeUrl);

  const summarizePage = () =>
    run(`Summarize this ${isVideo ? 'video' : 'page'} · ${STYLE_LABELS[style]}`, async () => {
      setStatus(isVideo ? 'Sending video to Gemini (long videos take a while)…' : 'Reading page…');
      const page = await readActivePage();
      const prompt = page.kind === 'video' ? videoPrompt(style, page.title) : pagePrompt(style, page.title, page.url);
      return pageMessage(page, prompt);
    }, true);

  /** Runs a GitHub action: fetch context, remember repo links, ask Gemini. */
  const githubRun = (label: string, prompt: string, load: () => Promise<GitHubContext>) =>
    run(label, async () => {
      const ctx = await load();
      sessionLinks.current = ctx.links;
      const { owner, repo, branch } = ctx.links;
      return { role: 'user', parts: [{ text: `${prompt}\n\n${linkHint(owner, repo, branch)}\n\n---\n${ctx.markdown}` }] };
    }, true);

  const analyzeRepo = () => {
    const ref = parseRepo(repoInput);
    if (!ref) {
      setTurns([{ role: 'model', text: 'Enter a repo as `owner/repo` or paste a GitHub URL.', error: true }]);
      return;
    }
    githubRun(`Analyze repo · ${ref.owner}/${ref.repo}`, REPO_PROMPT, () =>
      buildRepoDigest(ref, setStatus).then((d) => ({ markdown: d.markdown, links: d.links, label: '' })),
    );
  };

  const repoName = (r: RepoRef) => `${r.owner}/${r.repo}`;
  const explainFile = (ref: RepoRef, rest: string) =>
    githubRun(`Explain file · ${rest.split('/').pop()} (${repoName(ref)})`, FILE_PROMPT, () => buildFileContext(ref, rest, setStatus));
  const reviewPr = (ref: RepoRef, n: number) =>
    githubRun(`Review PR #${n} · ${repoName(ref)}`, PR_PROMPT, () => buildPrContext(ref, n, setStatus));
  const issueHelp = (ref: RepoRef, n: number) =>
    githubRun(`Issue helper #${n} · ${repoName(ref)}`, ISSUE_PROMPT, () => buildIssueContext(ref, n, setStatus));

  const ask = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    const fresh = history.current.length === 0;
    run(q, async () => {
      if (!fresh) return { role: 'user', parts: [{ text: q }] };
      // No context yet: answer about the current page.
      setStatus('Reading page…');
      const page = await readActivePage();
      return pageMessage(page, q, (question, text) =>
        `Answer using this page ("${page.title}", ${page.url}):\n\n${text}\n\n---\nQuestion: ${question}`,
      );
    }, fresh);
  };

  // Text sent from the right-click menu.
  useEffect(() => {
    const handle = async () => {
      const { pendingSelection } = await browser.storage.session.get('pendingSelection');
      const sel = pendingSelection as { text: string; url: string } | undefined;
      if (!sel?.text) return;
      await browser.storage.session.remove('pendingSelection');
      const preview = sel.text.length > 140 ? sel.text.slice(0, 140) + '…' : sel.text;
      run(`Explain selection: “${preview}”`, async () => ({
        role: 'user',
        parts: [{ text: `${SELECTION_PROMPT}\n\nSource: ${sel.url}\n\n---\n${sel.text}` }],
      }), true);
    };
    handle();
    browser.storage.session.onChanged.addListener(handle);
    return () => browser.storage.session.onChanged.removeListener(handle);
  }, [run]);

  const reset = () => {
    abort.current?.abort();
    history.current = [];
    setTurns([]);
  };

  return (
    <div className="app">
      <header>
        <strong>Gemini Lens</strong>
        <span className="muted small">{model}</span>
        <span className="spacer" />
        {turns.length > 0 && <button className="ghost" onClick={reset}>New</button>}
        <button className="ghost" onClick={() => browser.runtime.openOptionsPage()} title="Settings">⚙</button>
      </header>

      {!hasKey && (
        <div className="banner">
          Add your Gemini API key to get started.{' '}
          <button className="link" onClick={() => browser.runtime.openOptionsPage()}>Open settings</button>
        </div>
      )}

      <nav className="tabs">
        <button className={tab === 'page' ? 'active' : ''} onClick={() => setTab('page')}>Page · PDF · Video</button>
        <button className={tab === 'repo' ? 'active' : ''} onClick={() => setTab('repo')}>GitHub</button>
      </nav>

      <section className="controls">
        {tab === 'page' ? (
          <div className="row">
            <select value={style} onChange={(e) => setStyle(e.target.value as SummaryStyle)}>
              {Object.entries(STYLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="primary" disabled={busy} onClick={summarizePage}>
              {isVideo ? '▶ Summarize this video' : 'Summarize this page'}
            </button>
          </div>
        ) : (
          <>
          {ghPage && ghPage.kind !== 'repo' && (
            <div className="row page-actions">
              <span className="muted small">On this page:</span>
              {ghPage.kind === 'file' && (
                <button className="primary" disabled={busy} onClick={() => explainFile(ghPage.ref, ghPage.rest)}>
                  Explain {ghPage.rest.split('/').pop()}
                </button>
              )}
              {ghPage.kind === 'pull' && (
                <button className="primary" disabled={busy} onClick={() => reviewPr(ghPage.ref, ghPage.number)}>
                  Review PR #{ghPage.number}
                </button>
              )}
              {ghPage.kind === 'issue' && (
                <button className="primary" disabled={busy} onClick={() => issueHelp(ghPage.ref, ghPage.number)}>
                  Help with issue #{ghPage.number}
                </button>
              )}
            </div>
          )}
          <div className="row">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && analyzeRepo()}
              placeholder="owner/repo or GitHub URL"
            />
            <button className={ghPage && ghPage.kind !== 'repo' ? '' : 'primary'} disabled={busy} onClick={analyzeRepo}>
              Analyze repo
            </button>
          </div>
          </>
        )}
      </section>

      <main className="thread">
        {turns.length === 0 && (
          <div className="empty muted">
            <p>Summarize the current page, PDF or YouTube video, analyze a GitHub repo, or just ask a question below.</p>
            <p>On GitHub, open a file, pull request or issue to get <em>Explain file</em>, <em>Review PR</em> and <em>Issue helper</em>.</p>
            <p>Tip: select text on any page, right-click → <em>Explain with Gemini Lens</em>.</p>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="bubble user">{t.text}</div>
          ) : (
            <div key={i} className={`bubble model ${t.error ? 'error' : ''}`}>
              {t.text ? (
                <RepoLinksContext.Provider value={t.links ?? null}>
                  <Markdown text={t.text} streaming={busy && i === turns.length - 1} />
                </RepoLinksContext.Provider>
              ) : (
                <span className="muted pulse">{status || 'Working…'}</span>
              )}
              {t.text && !t.error && !(busy && i === turns.length - 1) && (
                <AnswerActions text={t.text} title={turns[i - 1]?.text ?? 'Gemini Lens answer'} />
              )}
            </div>
          ),
        )}
        <div ref={bottom} />
      </main>

      <footer>
        {busy && <button className="stop" onClick={() => abort.current?.abort()}>■ Stop</button>}
        <form onSubmit={ask} className="ask">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ask())}
            placeholder={turns.length ? 'Ask a follow-up…' : 'Ask about this page…'}
            rows={2}
          />
          <button className="primary" disabled={busy || !question.trim()}>Send</button>
        </form>
      </footer>
    </div>
  );
}

function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/API key not valid|API_KEY_INVALID/i.test(raw)) return 'Your Gemini API key is invalid. Check it in Settings.';
  if (/not found|is not supported/i.test(raw) && /model/i.test(raw))
    return 'That model is not available for your key. Pick another one in Settings.';
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(raw)) return 'Gemini rate limit or quota reached. Wait a minute and try again.';
  if (/503|UNAVAILABLE|overloaded|500|INTERNAL/i.test(raw))
    return 'Gemini is overloaded right now (tried 3 times). Wait a minute, or switch to another model in Settings (e.g. a Flash-Lite model).';
  if (/Failed to fetch|NetworkError/i.test(raw)) return 'Network error. Check your connection.';
  return `Error: ${raw}`;
}
