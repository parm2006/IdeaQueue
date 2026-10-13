import { useState } from 'react';
import { ArrowUpRight, Copy, KeyRound, LoaderCircle, Smartphone, X } from 'lucide-react';
import { createShortcutToken, listShortcutTokens, revokeShortcutToken, type ShortcutToken } from '../lib/shortcutTokens';
import { shortcutTemplateUrl } from '../lib/shortcutTemplate';

export function ShortcutSettings() {
  const [tokens, setTokens] = useState<ShortcutToken[]>([]);
  const [rawToken, setRawToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="shortcut-help" onToggle={e => { if (e.currentTarget.open) void run(async () => setTokens(await listShortcutTokens())); }}>
    <summary>Capture with iOS Shortcuts</summary><p>Add a thought with your iPhone’s Action button. The shared Shortcut lets you type or speak an idea.</p>
    <ol className="shortcut-steps"><li>Create a capture token below and copy its authorization.</li><li><a className="secondary-button shortcut-install" href={shortcutTemplateUrl} target="_blank" rel="noopener noreferrer"><Smartphone size={16}/> Install iPhone Shortcut <ArrowUpRight size={15}/></a><span>In Shortcuts, edit Idea Queue → Get Contents of URL → Headers. Paste the copied value into the blank Authorization field.</span></li><li>On supported iPhones, open Settings → Action Button → Shortcut → Idea Queue.</li></ol>
    <details className="shortcut-manual"><summary>Keep captures when you are offline</summary><p>Add an <strong>Append to File</strong> action after the Shortcut creates the JSON for an idea. Save it as a new line in <code>On My iPhone/Shortcuts/IdeaQ/outbox.ndjson</code>. This writes the thought to your phone before any network request.</p><p>Add a <strong>Sync saved ideas</strong> menu path that reads that file, POSTs <code>{window.location.origin}/api/sync</code> with <code>{'{"outbox":"the file contents"}'}</code>, then deletes the file only after it receives a success response. The full action-by-action setup is in the linked guide below.</p><a className="text-button" href="https://github.com/parm2006/IdeaQueue/blob/main/docs/SHORTCUTS.md#offline-outbox" target="_blank" rel="noopener noreferrer">Open offline Shortcut guide <ArrowUpRight size={14}/></a></details>
    <p>Your token adds notes only to your account. It cannot read notes. Date and time are added automatically; context stays blank unless you add it.</p>
    <div className="shortcut-actions"><button className="secondary-button" disabled={busy || !!rawToken} onClick={() => void run(async () => { const created = await createShortcutToken(); setRawToken(created.token); setCopied(false); setTokens(await listShortcutTokens()); })}>{busy ? <LoaderCircle size={16} className="spinning"/> : <KeyRound size={16}/>} Create capture token</button></div>
    {rawToken && <div><p>Copy the entire value below into Authorization, including “Bearer”. It is shown only here and disappears when you close Settings.</p><textarea className="shortcut-token" aria-label="Shortcut authorization header" value={`Bearer ${rawToken}`} readOnly rows={3}/><div className="shortcut-actions"><button className="secondary-button" onClick={() => void run(async () => { await navigator.clipboard.writeText(`Bearer ${rawToken}`); setCopied(true); })}><Copy size={16}/>{copied ? 'Authorization copied' : 'Copy authorization'}</button><button className="secondary-button" onClick={() => setRawToken('')}><X size={16}/> Hide token</button></div></div>}
    {tokens.filter(t => !t.revoked_at).map(token => <div className="shortcut-token-row" key={token.id}><span>{token.label}<br/><small>Created {new Date(token.created_at).toLocaleDateString()}</small></span><button className="text-button" disabled={busy} onClick={() => void run(async () => { await revokeShortcutToken(token.id); setRawToken(''); setTokens(await listShortcutTokens()); })}>Revoke</button></div>)}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <details className="shortcut-manual"><summary>Manual setup & troubleshooting</summary><p>If authorization is rejected, paste the complete Bearer value or create a new token if the previous one was revoked. For a connection error, use the offline outbox above or retry on Wi-Fi or cellular and allow the Shortcut to connect to ideaqueue.vercel.app when prompted.</p><code>{window.location.origin}/api/ideas</code><pre>{'Method: POST\nContent-Type: application/json\nAuthorization: Bearer YOUR_CAPTURE_TOKEN\n\n{"text":"Your dictated thought","priority":5}'}</pre><p>The request body must be JSON, with text set to the IdeaText variable. A successful request returns the new note’s ID and capture time.</p></details>
  </details>;
}
