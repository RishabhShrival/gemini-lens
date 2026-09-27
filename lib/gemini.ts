import { GoogleGenAI, type Content } from '@google/genai';
import { getSettings } from './settings';

export type { Content };

export class MissingKeyError extends Error {
  constructor() {
    super('No Gemini API key set. Open Settings and paste your key.');
  }
}

async function client() {
  const { apiKey, model } = await getSettings();
  if (!apiKey) throw new MissingKeyError();
  return { ai: new GoogleGenAI({ apiKey }), model };
}

const SYSTEM = `You are Gemini Lens, a browser assistant that summarizes pages, documents and code repositories.
Write clear GitHub-flavoured Markdown. Be accurate: only state what the provided content supports.
When asked for a diagram, use a fenced \`\`\`mermaid code block with valid Mermaid syntax
(prefer "flowchart TD"). Always wrap every node label AND every edge label in double quotes,
e.g. A["Server (API)"] -->|"sends data (JSON)"| B["DB"]. Use <br/> for line breaks, never \\n.`;

const RETRYABLE = /\b(429|500|503)\b|UNAVAILABLE|overloaded|RESOURCE_EXHAUSTED|INTERNAL/i;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))), { once: true });
  });

/**
 * Streams a response for a conversation. Calls onText with the full text so far.
 * Retries up to 3 times (1s, 3s backoff) on overload / rate-limit errors,
 * but only if nothing has been streamed yet.
 */
export async function streamChat(
  contents: Content[],
  onText: (full: string) => void,
  signal?: AbortSignal,
  onRetry?: (attempt: number) => void,
): Promise<string> {
  const { ai, model } = await client();
  const delays = [1000, 3000];
  for (let attempt = 0; ; attempt++) {
    let full = '';
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: { systemInstruction: SYSTEM, abortSignal: signal },
      });
      for await (const chunk of stream) {
        full += chunk.text ?? '';
        onText(full);
      }
      return full;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const delay = delays[attempt];
      if (signal?.aborted || full || delay === undefined || !RETRYABLE.test(msg)) throw e;
      onRetry?.(attempt + 1);
      await sleep(delay, signal);
    }
  }
}

/** Lists models available to this key that support generateContent. */
export async function listModels(apiKey: string): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list({ config: { pageSize: 100 } });
  const names: string[] = [];
  for await (const m of pager) {
    if (m.supportedActions?.includes('generateContent') && m.name) {
      names.push(m.name.replace(/^models\//, ''));
    }
  }
  return names.filter((n) => n.startsWith('gemini')).sort().reverse();
}
