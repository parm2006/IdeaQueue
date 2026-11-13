import { useEffect, useState } from 'react';
import { supabase, signInWithGoogle } from '../lib/supabase';
import { clearConnection, connectionCallback, parseConnectionRequest, pendingConnection, rememberConnection, type AgentConnectionRequest } from '../lib/agentConnection';
import type { WorkspaceUser } from '../lib/hosted';
import { AuthGate } from './AuthGate';
import { LegalLinks } from './LegalLinks';

export function ConnectAgent() {
  const [request] = useState<{ value?: AgentConnectionRequest; error?: string }>(() => {
    try {
      const value = window.location.pathname === '/connect' ? parseConnectionRequest(window.location.search, window.location.origin) : pendingConnection();
      if (!value) throw new Error('This connection request expired. Start again from your agent.');
      rememberConnection(value);
      return { value };
    } catch (e) { return { error: (e as Error).message }; }
  });
  const [user, setUser] = useState<WorkspaceUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(request.error ?? '');
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { if (alive) { setUser(session?.user ?? null); setLoading(false); } });
    supabase.auth.getSession().then(({ data, error }) => { if (alive) { setUser(data.session?.user ?? null); if (error) setError('Could not verify sign-in. Retry from your agent.'); setLoading(false); } }).catch(() => { if (alive) { setError('Could not verify sign-in.'); setLoading(false); } });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!request.value || !user || !supabase) return;
    let alive = true;
    setName(''); setError('');
    Promise.resolve(supabase.rpc('get_own_agent_oauth_client', { p_client_id: request.value.clientId, p_redirect_uri: request.value.redirectUri })).then(({ data, error }) => {
      if (!alive) return;
      if (error || typeof data?.[0]?.client_name !== 'string') { setError('This connector belongs to a different account or has an invalid return address. Sign in with the account that created it.'); return; }
      setName(data[0].client_name);
    }).catch(() => { if (alive) setError('Could not verify this connector. Retry from your agent.'); });
    return () => { alive = false; };
  }, [request, user?.id]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function finish(result: { code: string } | { error: string }) {
    if (!request.value) return;
    clearConnection();
    window.location.assign(connectionCallback(request.value, window.location.origin, result));
  }
  if (request.value && !user && !request.error) return <AuthGate configured={!!supabase} loading={loading} busy={busy} error={error} onSignIn={() => void run(signInWithGoogle)}/>;
  return <main className="auth-page"><section className="auth-card connector-consent">
    <h1>Connect to IdeaQueue</h1>
    {request.value && <>
      <p><strong>{name || 'Your agent'}</strong> is requesting access to <strong>{user?.email || 'your IQ account'}</strong>.</p>
      <p>The client name is supplied by the requesting app. Approve only if you started this connection and recognize its return address.</p>
      <p>Allow reading your queued cards ending with the separate word AI or agent (any capitalization) and their context. Cards without that ending and reviewed cards stay hidden. You do not need to approve cards individually. This connection cannot edit, delete, or review cards, and has no database access.</p>
      <p>You can disconnect it in Settings. Information already received by the agent remains subject to its provider’s policy.</p>
      <p>Return to <code className="connector-return">{request.value.redirectUri}</code></p>
      <div className="shortcut-actions"><button className="secondary-button" disabled={busy || !name} onClick={() => finish({ error: 'access_denied' })}>Deny</button><button className="button" disabled={busy || !name || !user || !!error} onClick={() => void run(async () => {
        const r = request.value!;
        if (Date.now() - r.startedAt > 10 * 60 * 1000) throw new Error('Request expired. Start again from your agent.');
        const { data, error } = await supabase!.rpc('approve_agent_oauth', { p_client_id: r.clientId, p_redirect_uri: r.redirectUri, p_challenge: r.challenge, p_resource: r.resource });
        if (error || typeof data !== 'string') throw new Error('Could not authorize this connection. Check database setup and retry from your agent.');
        finish({ code: data });
      })}>{busy ? 'Connecting…' : 'Connect account'}</button></div>
    </>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <a className="text-button" href="/" onClick={clearConnection}>Cancel and return to IQ</a>
    <LegalLinks/>
  </section></main>;
}
