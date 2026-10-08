import { useState } from 'react';
import { Copy, KeyRound, LoaderCircle, X } from 'lucide-react';
import { createShortcutToken, listShortcutTokens, revokeShortcutToken, type ShortcutToken } from '../lib/shortcutTokens';

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
    <summary>Capture with iOS Shortcuts</summary><p>Use Dictate Text, then Get Contents of URL. This token can add notes to your account. It cannot read your notes.</p>
    <code>{window.location.origin}/api/ideas</code><pre>{'Method: POST\nContent-Type: application/json\nAuthorization: Bearer YOUR_CAPTURE_TOKEN\n\n{"text":"Your dictated thought","priority":5}'}</pre>
    <p>Date and time are added automatically. The note text selects a bucket if you leave it out. Context stays blank unless you send it.</p>
    <div className="shortcut-actions"><button className="secondary-button" disabled={busy || !!rawToken} onClick={() => void run(async () => { const created = await createShortcutToken(); setRawToken(created.token); setCopied(false); setTokens(await listShortcutTokens()); })}>{busy ? <LoaderCircle size={16} className="spinning"/> : <KeyRound size={16}/>} Create capture token</button></div>
    {rawToken && <div><p>Copy this token into your personal Shortcut now. It is shown only here and disappears when you close Settings.</p><textarea className="shortcut-token" aria-label="New capture token" value={rawToken} readOnly rows={3}/><div className="shortcut-actions"><button className="secondary-button" onClick={() => void run(async () => { await navigator.clipboard.writeText(rawToken); setCopied(true); })}><Copy size={16}/>{copied ? 'Copied' : 'Copy token'}</button><button className="secondary-button" onClick={() => setRawToken('')}><X size={16}/> Hide token</button></div></div>}
    {tokens.filter(t => !t.revoked_at).map(token => <div className="shortcut-token-row" key={token.id}><span>{token.label}<br/><small>Created {new Date(token.created_at).toLocaleDateString()}</small></span><button className="text-button" disabled={busy} onClick={() => void run(async () => { await revokeShortcutToken(token.id); setRawToken(''); setTokens(await listShortcutTokens()); })}>Revoke</button></div>)}
    {error && <p className="dialog-error" role="alert">{error}</p>}
  </details>;
}
