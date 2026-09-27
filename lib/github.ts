import { getSettings } from './settings';

export interface RepoRef {
  owner: string;
  repo: string;
}

const RESERVED = new Set([
  'settings', 'orgs', 'marketplace', 'explore', 'topics', 'trending', 'collections',
  'notifications', 'pulls', 'issues', 'login', 'features', 'sponsors', 'search', 'about',
]);

/** Accepts "owner/repo" or any github.com URL inside a repo. */
export function parseRepo(input: string): RepoRef | null {
  const s = input.trim();
  const m =
    s.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i) ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  const [, owner = '', rawRepo = ''] = m;
  if (!owner || !rawRepo || RESERVED.has(owner.toLowerCase())) return null;
  return { owner, repo: rawRepo.replace(/\.git$/, '') };
}

export type GitHubPage =
  | { kind: 'repo'; ref: RepoRef }
  | { kind: 'file'; ref: RepoRef; rest: string } // rest = "<branch>/<path>" (branch may contain "/")
  | { kind: 'pull'; ref: RepoRef; number: number }
  | { kind: 'issue'; ref: RepoRef; number: number };

/** Works out what kind of GitHub page a URL points to. */
export function parseGitHubPage(url: string): GitHubPage | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== 'github.com') return null;
  const ref = parseRepo(url);
  if (!ref) return null;
  const [, , , section, ...rest] = u.pathname.split('/');
  const n = Number(rest[0]);
  if (section === 'pull' && n > 0) return { kind: 'pull', ref, number: n };
  if (section === 'issues' && n > 0) return { kind: 'issue', ref, number: n };
  if (section === 'blob' && rest.length >= 2) return { kind: 'file', ref, rest: rest.map(decodeURIComponent).join('/') };
  return { kind: 'repo', ref };
}

/** Everything needed to turn repo-relative paths into GitHub links. */
export interface RepoLinks {
  owner: string;
  repo: string;
  branch: string;
  files: Set<string>;
  dirs: Set<string>;
}

/** Returns a github.com URL for a path that really exists in the repo, else null. */
export function linkForPath(links: RepoLinks, rawPath: string): string | null {
  const path = rawPath.trim().replace(/^\.?\//, '').replace(/\/$/, '');
  const kind = links.files.has(path) ? 'blob' : links.dirs.has(path) ? 'tree' : null;
  if (!kind) return null;
  const enc = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${links.owner}/${links.repo}/${kind}/${encodeURIComponent(links.branch)}/${enc}`;
}

async function gh<T>(path: string, raw = false): Promise<T> {
  const { githubToken } = await getSettings();
  const headers: Record<string, string> = {
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub rate limit reached. Add a GitHub token in Settings (free, read-only is enough).');
  }
  if (res.status === 404) throw new Error('Repository not found (or it is private and no token is set).');
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return (raw ? res.text() : res.json()) as Promise<T>;
}

interface TreeItem {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

interface RepoMeta {
  full_name: string; description: string | null; default_branch: string;
  stargazers_count: number; language: string | null; topics?: string[]; license?: { spdx_id: string } | null;
}

/** Repo metadata + file tree (2 API calls). */
async function repoOverview(ref: RepoRef) {
  const base = `/repos/${ref.owner}/${ref.repo}`;
  const meta = await gh<RepoMeta>(base);
  const tree = await gh<{ tree: TreeItem[]; truncated: boolean }>(
    `${base}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`,
  );
  const items = tree.tree.filter((t) => !SKIP_DIRS.test(t.path + (t.type === 'tree' ? '/' : '')));
  const files = items.filter((t) => t.type === 'blob');
  const links: RepoLinks = {
    owner: ref.owner,
    repo: ref.repo,
    branch: meta.default_branch,
    files: new Set(files.map((f) => f.path)),
    dirs: new Set(items.filter((t) => t.type === 'tree').map((t) => t.path)),
  };
  const treeMd = `## File tree (${files.length} files${files.length > 600 || tree.truncated ? ', truncated' : ''})\n\`\`\`\n${files
    .slice(0, 600)
    .map((f) => f.path)
    .join('\n')}\n\`\`\``;
  return { base, meta, files, links, treeMd, truncated: tree.truncated };
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '\n…[truncated]' : t);

const KEY_FILES = [
  /^package\.json$/, /^requirements.*\.txt$/, /^pyproject\.toml$/, /^setup\.py$/, /^Cargo\.toml$/,
  /^go\.mod$/, /^pom\.xml$/, /^build\.gradle(\.kts)?$/, /^Gemfile$/, /^composer\.json$/,
  /^Dockerfile$/, /^docker-compose\.ya?ml$/, /^Makefile$/, /^CMakeLists\.txt$/, /^platformio\.ini$/,
  /^(vite|next|webpack|wxt)\.config\.\w+$/, /^tsconfig\.json$/, /^\.env\.example$/,
];

const ENTRY_HINTS =
  /(^|\/)(main|index|app|server|cli|__main__|manage|lib)\.(py|js|ts|tsx|jsx|go|rs|java|rb|cpp|c|kt)$/;

const SKIP_DIRS = /(^|\/)(node_modules|dist|build|vendor|\.git|\.next|target|__pycache__|coverage|venv|\.venv)\//;

const MAX_FILE_CHARS = 8_000;
const MAX_FILES = 14;

export interface RepoDigest {
  ref: RepoRef;
  markdown: string;
  fileCount: number;
  links: RepoLinks;
}

export async function buildRepoDigest(ref: RepoRef, onStatus?: (s: string) => void): Promise<RepoDigest> {
  onStatus?.('Fetching repository info…');
  const { base, meta, files, links, treeMd } = await repoOverview(ref);

  const [languages, readme] = await Promise.all([
    gh<Record<string, number>>(`${base}/languages`).catch(() => ({}) as Record<string, number>),
    gh<string>(`${base}/readme`, true).catch(() => ''),
  ]);

  // Pick config/manifest files first, then likely entry points (shallowest first).
  const picks = [
    ...files.filter((f) => KEY_FILES.some((re) => re.test(f.path.split('/').pop()!)) && f.path.split('/').length <= 2),
    ...files
      .filter((f) => ENTRY_HINTS.test(f.path))
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length),
  ]
    .filter((f, i, arr) => arr.findIndex((x) => x.path === f.path) === i && (f.size ?? 0) < 200_000)
    .slice(0, MAX_FILES);

  onStatus?.(`Reading ${picks.length} key files…`);
  const contents = await Promise.all(
    picks.map(async (f) => {
      const path = f.path.split('/').map(encodeURIComponent).join('/');
      const text = await gh<string>(`${base}/contents/${path}?ref=${encodeURIComponent(meta.default_branch)}`, true).catch(() => '');
      return { path: f.path, text: clip(text, MAX_FILE_CHARS) };
    }),
  );

  const langTotal = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
  const langLine = Object.entries(languages)
    .slice(0, 8)
    .map(([k, v]) => `${k} ${((v / langTotal) * 100).toFixed(1)}%`)
    .join(', ');

  const markdown = [
    `# Repository: ${meta.full_name}`,
    `Description: ${meta.description ?? '(none)'}`,
    `Default branch: ${meta.default_branch} · Stars: ${meta.stargazers_count} · License: ${meta.license?.spdx_id ?? 'unknown'}`,
    `Languages: ${langLine || meta.language || 'unknown'}`,
    meta.topics?.length ? `Topics: ${meta.topics.join(', ')}` : '',
    `\n${treeMd}`,
    `\n## README\n${readme ? readme.slice(0, 30_000) : '(no README)'}`,
    `\n## Key files`,
    ...contents.filter((c) => c.text).map((c) => `\n### ${c.path}\n\`\`\`\n${c.text}\n\`\`\``),
  ]
    .filter(Boolean)
    .join('\n');

  return { ref, markdown, fileCount: files.length, links };
}

export interface GitHubContext {
  markdown: string;
  links: RepoLinks;
  label: string;
}

/** A single file plus the repo tree, so Gemini can explain how it fits in. */
export async function buildFileContext(ref: RepoRef, rest: string, onStatus?: (s: string) => void): Promise<GitHubContext> {
  onStatus?.('Fetching file…');
  const ov = await repoOverview(ref);
  // Work out branch vs. path: pick the longest known file path that `rest` ends with.
  const path =
    [...ov.links.files].filter((p) => rest.endsWith('/' + p)).sort((a, b) => b.length - a.length)[0] ??
    rest.split('/').slice(1).join('/');
  const branch = rest.slice(0, rest.length - path.length - 1) || ov.meta.default_branch;
  const encPath = path.split('/').map(encodeURIComponent).join('/');
  const text = await gh<string>(`${ov.base}/contents/${encPath}?ref=${encodeURIComponent(branch)}`, true);
  const links = { ...ov.links, branch };
  const markdown = [
    `# Repository: ${ov.meta.full_name} (branch ${branch})`,
    `Description: ${ov.meta.description ?? '(none)'}`,
    `\n${ov.treeMd}`,
    `\n## File being explained: ${path}\n\`\`\`\n${clip(text, 60_000)}\n\`\`\``,
  ].join('\n');
  return { markdown, links, label: path };
}

interface PrFile { filename: string; status: string; additions: number; deletions: number; patch?: string }

/** Pull request metadata + diff. */
export async function buildPrContext(ref: RepoRef, n: number, onStatus?: (s: string) => void): Promise<GitHubContext> {
  onStatus?.(`Fetching PR #${n}…`);
  const ov = await repoOverview(ref);
  const [pr, files] = await Promise.all([
    gh<{
      title: string; body: string | null; user: { login: string }; state: string; merged: boolean;
      base: { ref: string }; head: { ref: string }; additions: number; deletions: number; changed_files: number;
    }>(`${ov.base}/pulls/${n}`),
    gh<PrFile[]>(`${ov.base}/pulls/${n}/files?per_page=100`),
  ]);
  let budget = 150_000;
  const diffs = files.map((f) => {
    const patch = f.patch ? clip(f.patch, Math.min(15_000, Math.max(0, budget))) : '(binary or too large — no diff)';
    budget -= patch.length;
    return `\n### ${f.filename} (${f.status}, +${f.additions} −${f.deletions})\n\`\`\`diff\n${patch}\n\`\`\``;
  });
  const markdown = [
    `# Pull request #${n} in ${ov.meta.full_name}: ${pr.title}`,
    `Author: ${pr.user.login} · State: ${pr.merged ? 'merged' : pr.state} · ${pr.head.ref} → ${pr.base.ref}`,
    `Changes: ${pr.changed_files} files, +${pr.additions} −${pr.deletions}${files.length < pr.changed_files ? ` (showing first ${files.length})` : ''}`,
    `\n## Description\n${pr.body?.trim() || '(no description)'}`,
    `\n## Diff`,
    ...diffs,
  ].join('\n');
  return { markdown, links: ov.links, label: `PR #${n}: ${pr.title}` };
}

/** Issue + comments + repo tree, so Gemini can point at likely files. */
export async function buildIssueContext(ref: RepoRef, n: number, onStatus?: (s: string) => void): Promise<GitHubContext> {
  onStatus?.(`Fetching issue #${n}…`);
  const ov = await repoOverview(ref);
  const [issue, comments, readme] = await Promise.all([
    gh<{ title: string; body: string | null; user: { login: string }; state: string; labels: { name: string }[]; pull_request?: unknown }>(
      `${ov.base}/issues/${n}`,
    ),
    gh<{ user: { login: string }; body: string }[]>(`${ov.base}/issues/${n}/comments?per_page=30`).catch(() => []),
    gh<string>(`${ov.base}/readme`, true).catch(() => ''),
  ]);
  const markdown = [
    `# Issue #${n} in ${ov.meta.full_name}: ${issue.title}`,
    `Opened by ${issue.user.login} · State: ${issue.state}${issue.labels.length ? ' · Labels: ' + issue.labels.map((l) => l.name).join(', ') : ''}`,
    `\n## Issue body\n${clip(issue.body?.trim() || '(empty)', 20_000)}`,
    comments.length ? `\n## Comments (${comments.length})\n` + comments.map((c) => `**${c.user.login}:** ${clip(c.body, 3_000)}`).join('\n\n') : '',
    `\n## README (excerpt)\n${clip(readme, 8_000) || '(none)'}`,
    `\n${ov.treeMd}`,
  ].join('\n');
  return { markdown, links: ov.links, label: `Issue #${n}: ${issue.title}` };
}
