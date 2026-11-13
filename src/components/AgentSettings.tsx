import { useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ShortcutToken } from '../lib/shortcutTokens';

export function AgentSettings() {
  const [tokens, setTokens] = useState<ShortcutToken[]>([]);
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [redirectUri, setRedirectUri] = useState('http://127.0.0.1/callback');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const command = `codex mcp add ideaqueue --url ${window.location.origin}/api/mcp`;
  const install = `${command} --oauth-client-id ${clientId} --oauth-resource ${window.location.origin}/api/mcp\ncodex mcp login ideaqueue`;
  async function rpc(name: string, args = {}) {
    if (!supabase) throw new Error('Agent connections require the Supabase app.');
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error('Could not update agent access. Sign in and check that the connector database migrations are installed.');
    return data;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setCopied(false);
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const reload = async () => setTokens(await rpc('list_agent_tokens') ?? []);
  return <details className="shortcut-help" id="agent-connection" onToggle={e => { if (e.currentTarget.open) void run(reload); else setToken(''); }}>
    <summary>Connect Codex / AI agents</summary>
    <p>Give your agent read-only access to queued cards ending in AI or agent, including their context. Other cards and reviewed cards stay hidden. This does not run an agent automatically.</p>
    <ol className="shortcut-steps">
      <li>End a card’s text with the separate word “AI” or “agent”, in any capitalization. Only queued cards ending with one of those words are available. Remove the word to hide a card; there are no individual approval steps.</li>
      <li>Create a connector while signed in to IQ:<label className="field-label">Agent return address<input aria-label="Agent return address" value={redirectUri} onChange={e => { setRedirectUri(e.target.value); setClientId(''); }}/></label><p>The default is for Codex. Other clients must provide their exact HTTPS or loopback return address.</p><button className="secondary-button" type="button" disabled={busy || !!clientId} onClick={() => void run(async () => { const id = await rpc('register_agent_oauth_client', { p_name: 'My AI agent', p_redirect_uris: [redirectUri.trim()] }); if (typeof id !== 'string') throw new Error('No connector ID was returned.'); setClientId(id); })}>Create account connector</button></li>
      <li>In Codex, install the connector and sign in:{clientId && <pre className="agent-command">{install}</pre>}<button className="secondary-button" type="button" disabled={busy || !clientId} onClick={() => void run(async () => { await navigator.clipboard.writeText(install); setCopied(true); })}><Copy size={16}/>{copied ? 'Copied' : 'Copy Codex install command'}</button></li>
      <li>Your browser opens IQ. Sign in to your own account, check the requesting app and return address, then choose Connect account.</li>
      <li>Ask your agent: “Use IdeaQueue to read my AI cards.”</li>
    </ol>
    <p>Other agents supporting remote MCP with OAuth can connect to <code>{window.location.origin}/api/mcp</code>. Create a connector in IQ Settings first, then enter its client ID in your agent. Public client registration is disabled. Each person must sign in to the same IQ account that created their connector. Client compatibility varies; IQ does not automatically install into every provider’s plugin directory.</p>
    <p>Your agent can read up to 100 queued cards ending in AI or agent, including their context. It cannot edit, review, or delete cards, and does not receive your website login or database credentials.</p>
    <p>Unsharing or disconnecting stops future reads; copies already received remain subject to your agent provider’s policy.</p>
    <details className="shortcut-manual"><summary>Advanced: clients using manual tokens</summary>
      <p>If your client does not support OAuth, create a read-only token. Keep it secret: anyone holding it can read your cards ending in AI or agent. Set IDEAQUEUE_AGENT_TOKEN in the environment that launches Codex, then use:</p>
      <pre className="agent-command">{command} --bearer-token-env-var IDEAQUEUE_AGENT_TOKEN</pre>
      <button className="secondary-button" type="button" disabled={busy || !!token} onClick={() => void run(async () => { const rows = await rpc('create_agent_token', { p_label: 'AI agent (manual)' }); if (!rows?.[0]?.token) throw new Error('No agent token was returned.'); setToken(rows[0].token); await reload(); })}><KeyRound size={16}/> Create agent token</button>
      {token && <div><p>Shown here until you close this panel. It is separate from your iPhone capture token.</p><textarea className="shortcut-token" aria-label="Agent token" value={token} readOnly rows={3}/><button className="text-button" type="button" onClick={() => setToken('')}>Hide token</button></div>}
    </details>
    <p>Unused connectors are removed after 14 days without a successful request or refresh. Agent requests share an account limit of 500/hour and 5,000/day; refreshes have a separate limit of 20/hour and 100/day. Normal website use does not count.</p>
    <h3>Connected agents</h3>
    {tokens.filter(t => !t.revoked_at).map(t => <div className="shortcut-token-row" key={t.id}><span>{t.label}<br/><small>Created {new Date(t.created_at).toLocaleDateString()}</small></span><button className="text-button" type="button" disabled={busy} onClick={() => void run(async () => { await rpc('revoke_agent_token', { p_id: t.id }); setToken(''); await reload(); })}>Revoke</button></div>)}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <p><a href="https://developers.openai.com/codex/mcp" target="_blank" rel="noopener noreferrer">Codex MCP setup guide</a> · <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy policy</a></p>
  </details>;
}
