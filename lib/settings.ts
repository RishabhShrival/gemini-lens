export interface Settings {
  apiKey: string;
  model: string;
  githubToken: string;
}

export const DEFAULT_MODEL = 'gemini-3.8-flash';

const DEFAULTS: Settings = { apiKey: '', model: DEFAULT_MODEL, githubToken: '' };

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...(stored as Partial<Settings>) };
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(s);
}
