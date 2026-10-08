import { Cloud, LoaderCircle, StickyNote } from 'lucide-react';

export function AuthGate({ configured, loading, busy, error, onSignIn }: {
  configured: boolean; loading: boolean; busy: boolean; error: string; onSignIn: () => void;
}) {
  return <main className="auth-page"><section className="auth-card">
    <a className="brand" href="/"><span className="brand-mark"><StickyNote size={24}/></span><span>ideaqueue<span className="brand-period">.</span></span></a>
    <div className="auth-paper note-yellow"><StickyNote size={30}/><h1>A little room<br/>for your thoughts.</h1><p>Capture a thought. See what’s next.<br/>One idea at a time.</p></div>
    {loading ? <div className="auth-loading" role="status"><LoaderCircle size={20} className="spinning"/> Opening your private box…</div> : <>
      <button className="button google-signin" disabled={!configured || busy} onClick={onSignIn}>{busy ? <LoaderCircle size={18} className="spinning"/> : <span className="google-mark" aria-hidden="true">G</span>} Continue with Google</button>
      <p className="auth-caption">{configured ? 'Your account has its own private idea box.' : 'Sign-in is being configured. Please check back soon.'}</p>
    </>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <p className="auth-private"><Cloud size={14}/> Your notes follow you from phone to desktop.</p>
  </section></main>;
}
