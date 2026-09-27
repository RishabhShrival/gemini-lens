/**
 * Fixes the syntax mistakes LLMs most often make in Mermaid flowcharts:
 * unquoted labels containing (), {}, :, etc., and literal "\n" line breaks.
 */
export function repairMermaid(src: string): string {
  const esc = (t: string) => t.trim().replace(/"/g, '#quot;');
  // A label ends where an arrow, "&", ";", ":::" or end of line follows.
  const END = String.raw`(?=\s*(?:$|[-=.<]{2}|-\.|&|;|:::))`;
  const rules: [RegExp, (...m: string[]) => string][] = [
    // Edge labels: A -->|text| B  ->  A -->|"text"| B
    [/\|([^|\n]+)\|/g, (_m, t) => `|"${esc(t!)}"|`],
    // Inline edge labels: A -- text --> B  ->  A -->|"text"| B
    [/(\s)--\s+([^-|>\n][^>|\n]*?)\s+-->/g, (_m, sp, t) => `${sp}-->|"${esc(t!)}"|`],
    // Node labels: id[..], id{..}, id(..)  (skips shapes like [(db)], [[sub]], [/io/], ((circle)), {{hex}})
    [new RegExp(String.raw`(\b[\w-]+)\[(?![\[(/\\])(.*?)\]` + END, 'g'), (_m, id, t) => `${id}["${esc(t!)}"]`],
    [new RegExp(String.raw`(\b[\w-]+)\{(?!\{)(.*?)\}` + END, 'g'), (_m, id, t) => `${id}{"${esc(t!)}"}`],
    [new RegExp(String.raw`(\b[\w-]+)\((?![(\[{])(.*?)\)` + END, 'g'), (_m, id, t) => `${id}("${esc(t!)}")`],
  ];
  // Apply each rule only to text outside double quotes, re-splitting after every rule
  // so a rule never edits a label that an earlier rule just quoted.
  const outsideQuotes = (line: string, re: RegExp, fn: (...m: string[]) => string) =>
    line
      .split(/("[^"]*")/)
      .map((part, i) => (i % 2 ? part : part.replace(re, fn as (sub: string, ...args: unknown[]) => string)))
      .join('');

  return src
    .split('\n')
    .map((line) => rules.reduce((l, [re, fn]) => outsideQuotes(l, re, fn), line.replace(/\\n/g, '<br/>')))
    .join('\n');
}
