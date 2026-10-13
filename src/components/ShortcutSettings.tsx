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
    <summary>Capture with iOS Shortcuts</summary><p>Type or speak a thought with your iPhone’s Action button. The Shortcut saves it locally, even without service.</p>
    <ol className="shortcut-steps"><li>Create a capture token below and copy its authorization.</li><li><a className="secondary-button shortcut-install" href={shortcutTemplateUrl} target="_blank" rel="noopener noreferrer"><Smartphone size={16}/> Install iPhone Shortcut <ArrowUpRight size={15}/></a><span>In Shortcuts, edit Idea Queue Template → Get Contents of URL → Headers. Paste the copied value into the blank Authorization field.</span></li><li>On supported iPhones, open Settings → Action Button → Shortcut and select your installed Idea Queue Template.</li></ol>
    <details className="shortcut-manual"><summary>How the offline queue works</summary><p>The template creates <code>On My iPhone/IdeaQ/outbox.txt</code> and appends each thought before checking Wi-Fi. When run on Wi-Fi, it sends the whole queue to your account and clears the file after the server confirms success. Failed requests leave the queue intact.</p><p>On first use, allow file access and select your own On My iPhone destination if prompted. Reconnecting alone does not run the Shortcut; capture another thought to retry syncing.</p><a className="text-button" href="https://github.com/parm2006/IdeaQueue/blob/main/docs/SHORTCUTS.md#offline-outbox" target="_blank" rel="noopener noreferrer">Open offline Shortcut guide <ArrowUpRight size={14}/></a></details>
    <p>Your token adds notes only to your account. It cannot read notes. Date and time are added automatically; context stays blank unless you add it.</p>
    <div className="shortcut-actions"><button className="secondary-button" disabled={busy || !!rawToken} onClick={() => void run(async () => { const created = await createShortcutToken(); setRawToken(created.token); setCopied(false); setTokens(await listShortcutTokens()); })}>{busy ? <LoaderCircle size={16} className="spinning"/> : <KeyRound size={16}/>} Create capture token</button></div>
    {rawToken && <div><p>Copy the entire value below into Authorization, including “Bearer”. It is shown only here and disappears when you close Settings.</p><textarea className="shortcut-token" aria-label="Shortcut authorization header" value={`Bearer ${rawToken}`} readOnly rows={3}/><div className="shortcut-actions"><button className="secondary-button" onClick={() => void run(async () => { await navigator.clipboard.writeText(`Bearer ${rawToken}`); setCopied(true); })}><Copy size={16}/>{copied ? 'Authorization copied' : 'Copy authorization'}</button><button className="secondary-button" onClick={() => setRawToken('')}><X size={16}/> Hide token</button></div></div>}
    {tokens.filter(t => !t.revoked_at).map(token => <div className="shortcut-token-row" key={token.id}><span>{token.label}<br/><small>Created {new Date(token.created_at).toLocaleDateString()}</small></span><button className="text-button" disabled={busy} onClick={() => void run(async () => { await revokeShortcutToken(token.id); setRawToken(''); setTokens(await listShortcutTokens()); })}>Revoke</button></div>)}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <details className="shortcut-manual"><summary>Setup & troubleshooting</summary><p>If authorization is rejected, paste the complete Bearer value into the Authorization header as plain text, without extra spaces or line breaks. Create a new token if the previous one was revoked. Allow the Shortcut to connect to ideaqueue.vercel.app when prompted.</p><code>{window.location.origin}/api/sync</code><pre>{'Method: POST\nContent-Type: application/json\nAuthorization: Bearer YOUR_CAPTURE_TOKEN\n\n{"outbox":"contents of your queue file"}'}</pre><p>The outbox value must come from reading the entire queue file. The server returns a saved count; the template clears the queue only when that count is greater than zero.</p></details>
  </details>;
}
