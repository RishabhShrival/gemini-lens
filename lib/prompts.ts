export type SummaryStyle = 'short' | 'detailed' | 'bullets';

export const STYLE_LABELS: Record<SummaryStyle, string> = {
  short: 'Short',
  detailed: 'Detailed',
  bullets: 'Key points',
};

export function videoPrompt(style: SummaryStyle, title: string): string {
  const how = {
    short: 'Write a TL;DR of 3–5 sentences.',
    detailed:
      'Write a detailed summary with headings: Overview, Chapters (each with a [mm:ss] timestamp), Key details, Takeaways.',
    bullets: 'List the 5–10 most important points as bullets, each starting with a [mm:ss] timestamp, then one line "Bottom line:".',
  }[style];
  return `Summarize this YouTube video titled "${title}".\n${how}`;
}

export function pagePrompt(style: SummaryStyle, title: string, url: string): string {
  const how = {
    short: 'Write a TL;DR of 3–5 sentences.',
    detailed:
      'Write a detailed summary with headings: Overview, Main points, Important details (numbers, names, dates), Takeaways.',
    bullets: 'List the 5–10 most important points as concise bullets, then one line "Bottom line:".',
  }[style];
  return `Summarize the following content titled "${title}" (${url}).\n${how}`;
}

export const SELECTION_PROMPT =
  'Explain and summarize the following selected text. If it is code, explain what it does.';

export const REPO_PROMPT = `Analyze this GitHub repository for a developer who is new to it. Use these sections:

## What it is
One paragraph: purpose and who it's for.

## Tech stack
Languages, frameworks, key libraries (from the manifests/config files).

## Project structure
The important folders/files and what each is responsible for.

## Entry points & how it works
Where execution starts and the main flow of data/control.

## How to run it
Setup, install, and run commands (from README/config; say if unknown).

## Architecture flow
A Mermaid flowchart (\`\`\`mermaid, flowchart TD) of the main components and how they connect. Keep it to at most 15 nodes.
For every node that corresponds to a real file or folder in the file tree, add a line
\`click NodeId "exact/path/from/tree"\` at the end of the diagram so the node links to it.

## Where to start reading
An ordered list of 3–6 files a newcomer should read first, with one line each.`;

/** Tells Gemini how to link file paths in its answer. */
export function linkHint(owner: string, repo: string, branch: string): string {
  return `When you mention a file from this repository, write it as a Markdown link to https://github.com/${owner}/${repo}/blob/${branch}/<path>. Only link paths that appear in the file tree.`;
}

export const FILE_PROMPT = `Explain the file below to a developer new to this repository. Use these sections:

## Purpose
What this file is responsible for, in 2–3 sentences.

## Key parts
The main functions / classes / exports and what each does (bullets, in order of importance).

## How it works
Walk through the main logic step by step. Mention any tricky or non-obvious code.

## How it connects
Which other files in the repo likely import it or are used by it (based on the imports and the file tree).

## Things to watch
Possible bugs, edge cases, or improvements. Say "none noticed" if nothing stands out.`;

export const PR_PROMPT = `Review this pull request like a senior engineer. Use these sections:

## Summary
What the PR does and why, in 2–4 sentences.

## Changes by file
One bullet per meaningful file: what changed.

## Risks & possible bugs
Concrete concerns with file and line context (logic errors, missing error handling, security, performance, breaking changes). Say "none found" if so. Don't invent problems.

## Suggestions
Specific, actionable improvements, including missing tests.

## Verdict
One of: ✅ Looks good to merge · 💬 Merge after minor fixes · ⚠️ Needs changes. One sentence why.`;

export const ISSUE_PROMPT = `Help a contributor work on this GitHub issue. Use these sections:

## Summary
What the issue is about and what the reporter expects, in 2–3 sentences. Include the current status/consensus from the comments.

## Likely cause
Your best hypothesis, clearly marked as a hypothesis.

## Files likely to change
3–8 files from the file tree most likely involved, each with one line on why. Only list paths that exist in the tree.

## Suggested approach
Numbered steps to fix or implement it, including how to test it.

## Open questions
Anything unclear that should be asked on the issue before starting.`;
