import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpRight, Box, Check, Cloud, Download, HelpCircle, LoaderCircle, LogOut, Mic, MoreHorizontal, Plus, RefreshCw, Settings2, Smartphone, StickyNote, Upload, X } from 'lucide-react';
import { availableCategory, bucketColors, createIdea, effectivePriority, inferCategory, orderIdeas, type Category, type Idea } from './lib/queue';
import { useIdeas } from './lib/useIdeas';
import { exportIdeas, readLocal, validateImport } from './lib/storage';
import { supabase, signInWithGoogle } from './lib/supabase';
import { AuthGate } from './components/AuthGate';
import { AccountSettings } from './components/AccountSettings';
import { IdeaNotebook } from './components/IdeaNotebook';
import { BucketMenu } from './components/BucketMenu';
import { AccountAvatar } from './components/AccountAvatar';
import { shortcutTemplateUrl } from './lib/shortcutTemplate';
import { speechConstructor, startDictation, type DictationStatus } from './lib/dictation';

type Screen = 'queue' | 'reviewed';
type Modal = 'new' | 'settings' | 'help' | Idea | null;
const categoryIcon = (c: Category) => <span className={`bucket-dot note-${bucketColors[c]}`} aria-hidden="true"/>;
const captureTime = (date: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));

function FocusNote({ idea, now, rank, onEdit }: { idea: Idea; now: number; rank: number; onEdit: () => void }) {
  return <article className={`focus-note note-${bucketColors[idea.category]}`} aria-label={rank === 0 ? 'Upcoming idea' : 'Queued idea'}>
    <div className="focus-note-top"><span className="note-category">{idea.category}</span><button className="icon-button" aria-label="Edit this idea" onClick={onEdit}><MoreHorizontal size={19}/></button></div>
    <h3>{idea.text}</h3>{idea.context && <p className="focus-context">{idea.context}</p>}
    <div className="focus-note-footer"><time dateTime={idea.created_at}>Captured {captureTime(idea.created_at)}</time><span title={`Starting priority: ${idea.priority}/10`}>{effectivePriority(idea, now)} <small>pts</small></span></div>
  </article>;
}

export default function App() {
  const store = useIdeas();
  const [screen, setScreen] = useState<Screen>('queue');
  const [bucket, setBucket] = useState<Category | 'all'>('all');
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [actionError, setActionError] = useState('');
  const [clock, setClock] = useState(Date.now);
  const [browsedId, setBrowsedId] = useState<string | null>(null);
  const [bucketMenu, setBucketMenu] = useState<{ category: Category; x: number; y: number } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active = store.ideas.filter(i => !i.reviewed_at);
  const reviewed = store.ideas.filter(i => i.reviewed_at).sort((a, b) => Date.parse(b.reviewed_at!) - Date.parse(a.reviewed_at!));
  const orderedQueue = useMemo(() => orderIdeas(store.ideas.filter(i => !i.reviewed_at && (bucket === 'all' || i.category === bucket))), [store.ideas, bucket]);
  const queueCount = orderedQueue.length;
  const pageIndex = Math.max(0, orderedQueue.findIndex(idea => idea.id === browsedId));
  const focused = orderedQueue[pageIndex];

  useEffect(() => {
    if (store.ready && bucket !== 'all' && !store.buckets.includes(bucket)) { setBucket('all'); setBrowsedId(null); }
  }, [store.ready, store.buckets, bucket]);

  useEffect(() => { const interval = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(interval); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (modal) { dialogRef.current?.showModal(); setActionError(''); } else dialogRef.current?.close(); }, [modal]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (store.ready && !busy && !modal) setModal('new'); } };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [busy, modal, store.ready]);
  useEffect(() => { setModal(null); setScreen('queue'); setBucket('all'); setBucketMenu(null); setBrowsedId(null); setActionError(''); setToast(''); }, [store.user?.id]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setActionError('');
    try { await action(); } catch (e) { setActionError(e instanceof Error ? e.message : (e as { message?: string })?.message || 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  }
  const popNext = () => run(async () => {
    if (!focused) return;
    if (pageIndex === 0) {
      const popped = await store.pop(bucket === 'all' ? undefined : bucket, focused.id);
      if (!popped) setToast('The queue is empty.');
    } else {
      await store.save({ ...focused, reviewed_at: new Date().toISOString() }, true);
    }
    setBrowsedId(null);
  });
  const deleteBucket = (category: Category) => {
    setBucketMenu(null);
    if (category === 'General' || !window.confirm(`Delete the ${category} bucket? Its queued and reviewed notes will move to General. No notes will be deleted.`)) return;
    void run(async () => {
      await store.deleteBucket(category);
      if (bucket === category) { setBucket('all'); setBrowsedId(null); }
      setToast(`${category} removed. Its notes are in General.`);
    });
  };
  const navigate = (view: Screen, category: Category | 'all' = 'all') => {
    setBucketMenu(null); setScreen(view); setBucket(category); setBrowsedId(null); setActionError('');
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose an export smaller than 20 MB.');
      const parsed = validateImport(JSON.parse(await file.text()));
      const count = await store.importNotes(parsed); setToast(`Imported ${count} notes. Existing notes were kept.`);
    });
    if (importRef.current) importRef.current.value = '';
  };

  if (!store.hosted && !store.user) return <AuthGate configured={!!supabase} loading={store.loading} busy={busy} error={store.error || actionError} onSignIn={() => void run(signInWithGoogle)}/>;

  return <div className="app-shell pop-first">
    <aside className="sidebar">
      <a className="brand" href="/" onClick={e => { e.preventDefault(); navigate('queue'); }}><span className="brand-mark"><StickyNote size={24}/></span><span>ideaqueue<span className="brand-period">.</span></span></a>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav className="main-nav" aria-label="Workspace">
        <button className={screen === 'queue' && bucket === 'all' ? 'active' : ''} onClick={() => navigate('queue')}><Box size={18}/><span>Queue</span><span className="nav-count">{active.length}</span></button>
        <button className={screen === 'reviewed' ? 'active' : ''} onClick={() => navigate('reviewed')}><Check size={18}/><span>Reviewed</span><span className="nav-count">{reviewed.length}</span></button>
      </nav>
      <div className="nav-label bucket-heading">YOUR BUCKETS <span>{store.buckets.length}</span></div>
      <nav className="bucket-nav" aria-label="Idea buckets">{store.buckets.map(c => <button key={c} className={screen === 'queue' && bucket === c ? 'active' : ''} disabled={busy || !store.ready} onClick={() => navigate('queue', c)} onContextMenu={event => { event.preventDefault(); setBucketMenu({ category: c, x: event.clientX, y: event.clientY }); }} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setBucketMenu({ category: c, x: rect.right, y: rect.top }); } }}>{categoryIcon(c)}<span>{c}</span><span className="bucket-count">{active.filter(i => i.category === c).length}</span></button>)}</nav>
      <div className="sidebar-bottom"><button className="connection" onClick={() => setModal('settings')}><span className={`connection-dot ${store.user ? 'cloud-dot' : ''}`}/><span>{store.user ? 'Connected to your cloud' : 'Saved on this device'}</span><Settings2 size={14}/></button><a className="help-link" href={shortcutTemplateUrl} target="_blank" rel="noopener noreferrer"><Smartphone size={15}/> Install iPhone Shortcut <ArrowUpRight size={14}/></a></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div><span className="today">{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date())}</span><button className="icon-button" aria-label="Refresh notes" disabled={store.loading || busy} onClick={() => void store.refresh()}><RefreshCw size={17} className={store.loading ? 'spinning' : ''}/></button><AccountAvatar key={store.user?.id} user={store.user} label="Open account and storage settings" onOpen={() => setModal('settings')}/></div></header>
      <main>
        <div className="mobile-brand"><span><StickyNote size={20}/> ideaqueue.</span><AccountAvatar key={store.user?.id} user={store.user} label="Settings" onOpen={() => setModal('settings')}/></div>
        <section className="page-heading"><div><h1>{screen === 'reviewed' ? 'Reviewed' : bucket === 'all' ? 'Queue' : bucket}</h1></div><button className="button capture-button" aria-label="Add idea" onClick={() => setModal('new')} disabled={busy || !store.ready}><Plus size={19}/> Add idea <span className="button-shortcut">⌘ K</span></button></section>
        <nav className="mobile-nav" aria-label="Mobile workspace"><button className={screen === 'queue' ? 'active' : ''} onClick={() => navigate('queue')}><Box size={15}/> Queue <span>{active.length}</span></button><button className={screen === 'reviewed' ? 'active' : ''} onClick={() => navigate('reviewed')}><Check size={15}/> Reviewed <span>{reviewed.length}</span></button><select aria-label="Filter by bucket" value={bucket} disabled={busy} onChange={e => navigate('queue', e.target.value as Category | 'all')}><option value="all">All buckets</option>{store.buckets.map(c => <option key={c}>{c}</option>)}</select></nav>
        {(store.error || (actionError && !modal)) && <div className="error-banner" role="alert">{store.error || actionError}<button onClick={() => { setActionError(''); void store.refresh(); }}>Retry</button></div>}
        {screen === 'queue' ? <section className="idea-section">
          <div className="idea-box pop-box">
            <div className="pop-stage">
              {store.loading && !store.ideas.length ? <div className="empty-box"><LoaderCircle className="spinning" size={30}/><h3>Loading queue...</h3></div> : focused ? <IdeaNotebook key={bucket} index={pageIndex} count={queueCount} nextColors={[1, 2].filter(step => step < queueCount).map(step => bucketColors[orderedQueue[(pageIndex + step) % queueCount].category])} disabled={busy || !store.ready} onPageChange={index => setBrowsedId(orderedQueue[index].id)}><FocusNote idea={focused} now={clock} rank={pageIndex} onEdit={() => setModal(focused)}/></IdeaNotebook> : <div className="closed-box-state"><div className="closed-note-stack" aria-hidden="true"><span/><span/><span><StickyNote size={36}/></span></div><h3>Your queue is empty.</h3><p>Choose Add idea to start your queue.</p></div>}
            </div>
            <div className="box-lip"><span className="box-label"><Box size={15}/>{bucket === 'all' ? 'Queue' : bucket.toUpperCase()}</span></div>
          </div>
          <div className="pop-actions"><div className="note-action-row"><button className="button pop-button" disabled={!queueCount || busy || !store.ready} onClick={() => void popNext()}>{busy ? <LoaderCircle size={17} className="spinning"/> : <ArrowDownToLine size={17}/>} <span className="desktop-pop-label">Pop idea</span><span className="phone-pop-label">Pop idea</span></button>{focused && !busy ? <a className="button find-out-button" href={`https://www.google.com/search?${new URLSearchParams({ q: focused.text })}`} target="_blank" rel="noopener noreferrer" title="Search this idea on Google in a new browser tab">Find out <ArrowUpRight size={17}/></a> : <button className="button find-out-button" disabled title="No upcoming idea to search">Find out <ArrowUpRight size={17}/></button>}</div></div>
        </section> : <section className="idea-section reviewed-section">{reviewed.length ? <div className="reviewed-history">{reviewed.map(idea => <button key={idea.id} className="list-note" onClick={() => setModal(idea)}><span className={`list-note-icon note-${bucketColors[idea.category]}`}><StickyNote size={22}/></span><span className="list-note-text"><strong>{idea.text}</strong><span>{idea.category} · Popped {captureTime(idea.reviewed_at!)}</span></span><ArrowUpRight size={17}/></button>)}</div> : <div className="empty-box reviewed-empty"><Check size={28}/><h3>No reviewed ideas.</h3><p>Ideas appear here after you pop them out of the box.</p></div>}</section>}
        <div className="workspace-help"><button className="help-link" onClick={() => setModal('help')}><HelpCircle size={15}/> How IdeaQueue works</button></div>
      </main>
    </div>
    {bucketMenu && <BucketMenu {...bucketMenu} disabled={busy || !store.ready} onDelete={() => deleteBucket(bucketMenu.category)} onClose={() => setBucketMenu(null)}/>}
    <input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={e => void importFile(e.target.files?.[0])}/>
    <dialog ref={dialogRef} className="app-dialog" onCancel={() => setModal(null)} onClick={e => { if (e.target === dialogRef.current) setModal(null); }}><div className="dialog-content"><button className="icon-button dialog-close" aria-label="Close dialog" onClick={() => setModal(null)}><X size={21}/></button>
      {(modal === 'new' || (modal && typeof modal === 'object')) && <IdeaEditor buckets={store.buckets} key={typeof modal === 'object' ? modal.id : modal} idea={typeof modal === 'object' ? modal : undefined} busy={busy || !store.ready} onSave={idea => run(async () => { await store.save(idea, !!modal && typeof modal === 'object'); setModal(null); setToast('Saved in your queue.'); })} onReview={idea => run(async () => { await store.save({ ...idea, reviewed_at: idea.reviewed_at ? null : new Date().toISOString() }, true); setModal(null); setToast(idea.reviewed_at ? 'Back in your queue.' : 'Saved in Reviewed.'); })}/>}
      {modal === 'settings' && (store.hosted ? <HostedSettings email={store.user?.email} busy={busy} onMoveLocal={() => run(async () => { const count = await store.importNotes(readLocal() ?? []); setToast(`Moved ${count} browser notes online.`); })} onExport={() => exportIdeas(store.ideas)} onImport={() => importRef.current?.click()}/> : <AccountSettings buckets={store.buckets} onDeleteBucket={deleteBucket} email={store.user?.email} busy={busy || !store.ready} hourlyCleanup={store.hourlyCleanup} onCleanupChange={enabled => void run(() => store.setReviewedCleanup(enabled))} onSignOut={() => void run(async () => { const { error } = await supabase!.auth.signOut(); if (error) throw error; })} onExport={() => exportIdeas(store.ideas)} onImport={() => importRef.current?.click()}/>)}
      {modal === 'help' && <div className="help-content"><h2>How IdeaQueue works</h2><ol><li><strong>Browse the queue.</strong><span>The highest-priority idea appears first. Swipe up/down on a note or scroll over it to turn pages. On a keyboard, use ↑ / ↓ or Page Up / Page Down. The last page loops to the first; going back from the first opens the last. Long notes scroll within their page before the next gesture turns it. Back to top or Home returns to the highest priority.</span></li><li><strong>Add and review ideas.</strong><span>Add idea captures a typed or dictated thought. Pop idea moves the displayed note to Reviewed and returns to the highest remaining priority. Browsing does not mark notes reviewed. Find out searches the displayed note on Google.</span></li><li><strong>Priority and cleanup.</strong><span>Priority grows daily without rewriting notes; starting priority breaks ties between adjusted days. Reviewed notes clear hourly by default. Turn hourly cleanup off in Settings to retain each note for 7 days after review.</span></li></ol><p className="help-tip"><kbd>Ctrl / ⌘ K</kbd> opens Add idea.</p><button className="button" onClick={() => setModal(null)}>Got it <Check size={16}/></button></div>}
      {actionError && <div className="dialog-error" role="alert">{actionError}</div>}
    </div></dialog>
    {toast && <div className="toast" role="status"><span><Check size={17}/></span>{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16}/></button></div>}
  </div>;
}

function IdeaEditor({ idea, busy, buckets, onSave, onReview }: { buckets: Category[]; idea?: Idea; busy: boolean; onSave: (idea: Idea) => Promise<void>; onReview: (idea: Idea) => Promise<void> }) {
  const [text, setText] = useState(idea?.text ?? '');
  const [context, setContext] = useState(idea?.context ?? '');
  const [category, setCategory] = useState<Category | 'auto'>(idea?.category ?? 'auto');
  const [priority, setPriority] = useState(idea?.priority ?? 5);
  const selectedCategory = availableCategory(category === 'auto' ? inferCategory(text) : category, buckets);
  const [voiceError, setVoiceError] = useState('');
  const [voiceStatus, setVoiceStatus] = useState<DictationStatus>('idle');
  const [interimText, setInterimText] = useState('');
  const recognition = useRef<ReturnType<typeof startDictation> | null>(null);
  useEffect(() => () => recognition.current?.cancel(), []);
  const speechSupported = !!speechConstructor();
  const listening = voiceStatus !== 'idle';
  const dictate = () => {
    if (listening) { recognition.current?.stop(); return; }
    recognition.current?.cancel(); setVoiceError('');
    try {
      recognition.current = startDictation({
        onFinal: words => setText(t => `${t} ${words}`.trim().slice(0, 2000)),
        onInterim: setInterimText, onStatus: setVoiceStatus, onError: setVoiceError,
      });
    } catch (error) { setVoiceError(error instanceof Error ? error.message : 'Voice capture could not start.'); }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || listening) return;
    const fields = createIdea({ text, context, category: selectedCategory, priority, color: idea?.color });
    void onSave(idea ? { ...idea, ...fields, id: idea.id, created_at: idea.created_at, reviewed_at: idea.reviewed_at } : fields);
  };
  return <form className="idea-editor" onSubmit={submit} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit(); } }}>
    <h2>{idea ? 'Edit idea' : 'Add idea'}</h2>
    <div className={`editor-paper note-${bucketColors[selectedCategory]}`}><textarea autoFocus aria-label="Idea text" placeholder="Start with a thought..." maxLength={2000} value={text} onChange={e => setText(e.target.value)} required rows={4}/><div className="paper-tools"><span>{text.length}/2000</span><button type="button" className={`voice-button ${listening ? 'listening' : ''}`} onClick={dictate} disabled={!speechSupported || voiceStatus === 'stopping'} title={speechSupported ? 'Transcribes with your browser’s speech service' : 'Voice capture is unavailable in this browser'}><Mic size={15}/>{listening ? 'Stop recording' : speechSupported ? 'Start recording' : 'Voice unavailable'}</button></div></div>
    {listening && <div className="dictation-feedback" role="status"><span className="recording-dot"/><div><strong>{voiceStatus === 'starting' ? 'Allow microphone access to begin.' : voiceStatus === 'stopping' ? 'Finishing your transcript...' : 'Listening... speak naturally.'}</strong>{interimText && <p>{interimText}</p>}</div></div>}
    {!speechSupported && <p className="voice-support">Voice capture is unavailable in this browser. Try a browser with speech recognition, or use your keyboard’s dictation.</p>}
    {voiceError && <div className="dialog-error" role="alert">{voiceError}</div>}
    {category === 'auto' && <p className="bucket-suggestion">Suggested bucket: <strong>{selectedCategory}</strong><span> · based on your note</span></p>}
    <details className="note-options"><summary>Bucket, priority & context <span>optional</span></summary>
    <label className="field-label">Context <span>optional</span><textarea className="context-input" rows={2} maxLength={4000} placeholder="What would your future self need to know?" value={context} onChange={e => setContext(e.target.value)}/></label>
    <div className="editor-fields"><label className="field-label">Bucket<select aria-label="Bucket" value={category === 'auto' ? 'auto' : selectedCategory} onChange={e => setCategory(e.target.value as Category | 'auto')}><option value="auto">Choose automatically</option>{buckets.map(c => <option key={c}>{c}</option>)}</select></label><label className="field-label">Starting priority <span className="priority-number">{priority}/10</span><input type="range" min="1" max="10" value={priority} onChange={e => setPriority(Number(e.target.value))}/><span className="range-labels"><span>Whenever</span><span>Sooner</span></span></label></div>
    {idea && <p className="capture-stamp">Captured <time dateTime={idea.created_at}>{new Date(idea.created_at).toLocaleString()}</time></p>}

    </details><div className="editor-footer">{idea ? <button className="text-button" type="button" disabled={busy || listening} onClick={() => void onReview(idea)}>{idea.reviewed_at ? <RefreshCw size={16}/> : <ArrowDownToLine size={16}/>} {idea.reviewed_at ? 'Return to queue' : 'Mark reviewed'}</button> : <span className="editor-hint">Context stays blank unless you add it.</span>}<button className="button" type="submit" disabled={busy || listening || !text.trim()}>{busy ? <LoaderCircle size={16} className="spinning"/> : <Plus size={16}/>} {idea ? 'Save changes' : 'Add idea'}</button></div>
  </form>;
}

function HostedSettings({ email, busy, onMoveLocal, onExport, onImport }: { email?: string; busy: boolean; onMoveLocal: () => Promise<void>; onExport: () => void; onImport: () => void }) {
  const [hasLocal] = useState(() => { try { return !!readLocal()?.length; } catch { return false; } });
  return <div className="settings-content"><h2>Settings</h2><div className="storage-status"><span className="connection-dot cloud-dot"/><div><strong>Only your account can open this site</strong><span>{email || 'Signed in through Sites'}</span></div></div><p>Your notes are saved online. Open this same link on your phone or laptop to use the same box.</p>
    <div className="phone-install"><h3>Add to Home Screen</h3><p>On iPhone, open this link in Safari. Tap Share, then Add to Home Screen. Turn on Open as Web App if offered.</p></div>
    <details className="shortcut-help"><summary>Capture with iOS Shortcuts</summary><p>Use Dictate Text, then Get Contents of URL with POST and a JSON body. The server fills in the capture date and suggests a bucket when omitted.</p><code>{window.location.origin}/api/ideas</code><pre>{'{"text":"Your dictated thought","priority":5}'}</pre><p>Set Content-Type to application/json. Private API requests also need the owner service credential in the OAI-Sites-Authorization header: Bearer followed by your credential. Keep it in your personal Shortcut. A browser sign-in cookie will not authorize Shortcuts.</p><p>The capture API is ready. This app never displays or bundles the site credential; configure that privately before using the Shortcut.</p></details>
    <details className="backup-section"><summary>Backup & existing browser notes</summary><p>Exports include queued and reviewed notes. Imports add new IDs without replacing existing notes.</p><div><button className="secondary-button" onClick={onExport}><Download size={16}/> Export notes</button><button className="secondary-button" onClick={onImport} disabled={busy}><Upload size={16}/> Import notes</button>{hasLocal && <button className="secondary-button" disabled={busy} onClick={() => void onMoveLocal()}><Cloud size={16}/> Move this browser’s notes online</button>}</div></details><a className="text-button signout-link" href="/signout-with-chatgpt?return_to=%2F" target="_top"><LogOut size={16}/> Sign out</a>
  </div>;
}
