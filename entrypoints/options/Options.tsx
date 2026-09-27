import { useEffect, useState } from 'react';
import { DEFAULT_MODEL, getSettings, saveSettings, type Settings } from '@/lib/settings';
import { listModels } from '@/lib/gemini';

export default function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    getSettings().then(setS);
  }, []);

  if (!s) return null;

  const update = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  const save = async () => {
    await saveSettings({ apiKey: s.apiKey.trim(), model: s.model.trim() || DEFAULT_MODEL, githubToken: s.githubToken.trim() });
    setMsg({ text: 'Saved.', ok: true });
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const list = await listModels(s.apiKey.trim());
      setModels(list);
      const note = list.includes(s.model) ? '' : ` Note: "${s.model}" isn't in your list; choose one below.`;
      setMsg({ text: `Key works. ${list.length} models available.${note}`, ok: true });
    } catch (e) {
      setMsg({ text: `Key check failed: ${e instanceof Error ? e.message : e}`, ok: false });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="options">
      <h1>Gemini Lens settings</h1>
      <p className="muted">
        Your keys are stored only in this browser (<code>chrome.storage.local</code>) and are sent only to Google's
        Gemini API and GitHub's API.
      </p>

      <label>
        Gemini API key
        <div className="row">
          <input
            type={showKey ? 'text' : 'password'}
            value={s.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder="AIza…"
            autoComplete="off"
          />
          <button className="ghost" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</button>
        </div>
        <span className="muted small">
          Get a free key at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>
        </span>
      </label>

      <label>
        Model
        <div className="row">
          <input list="models" value={s.model} onChange={(e) => update({ model: e.target.value })} />
          <button className="ghost" disabled={!s.apiKey || testing} onClick={test}>
            {testing ? 'Checking…' : 'Test key & load models'}
          </button>
        </div>
        <datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        <span className="muted small">Flash models are fast and cheap; use a Pro model for deeper repo analysis.</span>
      </label>

      <label>
        GitHub token <span className="muted">(optional)</span>
        <input
          type="password"
          value={s.githubToken}
          onChange={(e) => update({ githubToken: e.target.value })}
          placeholder="github_pat_…"
          autoComplete="off"
        />
        <span className="muted small">
          Raises GitHub's limit from 60 to 5,000 requests/hour and allows private repos. A{' '}
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
            fine-grained token
          </a>{' '}
          with read-only "Contents" access is enough.
        </span>
      </label>

      <div className="row">
        <button className="primary" onClick={save}>Save</button>
        {msg && <span className={msg.ok ? 'ok' : 'err'}>{msg.text}</span>}
      </div>
    </div>
  );
}
