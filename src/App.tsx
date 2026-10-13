import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpRight, BookOpen, Box, Check, Cloud, Code2, Download, HelpCircle, Leaf, LoaderCircle, LogOut, Mic, MoreHorizontal, Plus, RefreshCw, Settings2, Smartphone, StickyNote, Upload, X } from 'lucide-react';
import { categories, colors, createIdea, effectivePriority, inferCategory, PriorityQueue, type Category, type Idea, type NoteColor } from './lib/queue';
import { useIdeas } from './lib/useIdeas';
import { exportIdeas, readLocal, validateImport } from './lib/storage';
import { supabase, signInWithGoogle } from './lib/supabase';
import { AuthGate } from './components/AuthGate';
import { AccountSettings } from './components/AccountSettings';
import { shortcutTemplateUrl } from './lib/shortcutTemplate';
import { speechConstructor, startDictation, type DictationStatus } from './lib/dictation';

type Screen = 'queue' | 'reviewed';
type Modal = 'new' | 'settings' | 'help' | Idea | null;
const categoryIcon = (c: Category) => c === 'Computer science' ? <Code2 size={17}/> : c === 'Reading' ? <BookOpen size={17}/> : c === 'Personal' ? <Leaf size={17}/> : <span className={`bucket-dot ${c.replaceAll(' ', '-').toLowerCase()}`}/>;
const captureTime = (date: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));

function FocusNote({ idea, now, onEdit }: { idea: Idea; now: number; onEdit: () => void }) {
  return <article className={`focus-note note-${idea.color}`} aria-label="Upcoming idea">
    <div className="focus-note-top"><span className="note-category">{idea.category}</span><span className="focus-note-label">UP NEXT</span><button className="icon-button" aria-label="Edit upcoming idea" onClick={onEdit}><MoreHorizontal size={19}/></button></div>
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
  const importRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active = store.ideas.filter(i => !i.reviewed_at);
  const reviewed = store.ideas.filter(i => i.reviewed_at).sort((a, b) => Date.parse(b.reviewed_at!) - Date.parse(a.reviewed_at!));
  const scopedQueue = active.filter(i => bucket === 'all' || i.category === bucket);
  const queueCount = scopedQueue.length;
  const focused = new PriorityQueue(scopedQueue).peek();

  useEffect(() => { const interval = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(interval); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (modal) { dialogRef.current?.showModal(); setActionError(''); } else dialogRef.current?.close(); }, [modal]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (store.ready && !busy && !modal) setModal('new'); } };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [busy, modal, store.ready]);
  useEffect(() => { setModal(null); setScreen('queue'); setBucket('all'); setActionError(''); setToast(''); }, [store.user?.id]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setActionError('');
    try { await action(); } catch (e) { setActionError(e instanceof Error ? e.message : (e as { message?: string })?.message || 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  }
  const popNext = () => run(async () => {
    if (!focused) return;
    const popped = await store.pop(bucket === 'all' ? undefined : bucket, focused.id);
    if (!popped) setToast('This box is empty.');
  });
  const navigate = (view: Screen, category: Category | 'all' = 'all') => {
    setScreen(view); setBucket(category); setActionError('');
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
      <div className="sidebar-intro">A little space for big ideas.</div>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav className="main-nav" aria-label="Workspace">
        <button className={screen === 'queue' && bucket === 'all' ? 'active' : ''} onClick={() => navigate('queue')}><Box size={18}/><span>Your idea box</span><span className="nav-count">{active.length}</span></button>
        <button className={screen === 'reviewed' ? 'active' : ''} onClick={() => navigate('reviewed')}><Check size={18}/><span>Reviewed</span><span className="nav-count">{reviewed.length}</span></button>
      </nav>
      <div className="nav-label bucket-heading">YOUR BUCKETS <span>{categories.length}</span></div>
      <nav className="bucket-nav" aria-label="Idea buckets">{categories.map(c => <button key={c} className={screen === 'queue' && bucket === c ? 'active' : ''} onClick={() => navigate('queue', c)}>{categoryIcon(c)}<span>{c}</span><span className="bucket-count">{active.filter(i => i.category === c).length}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="desk-doodle" aria-hidden="true"><span/><span/><span/><svg viewBox="0 0 130 55"><path d="M10 42c38 12 35-43 72-30m-6-8 10 8-12 8" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></div><p>Make room for<br/><em>one thought at a time.</em></p><button className="connection" onClick={() => setModal('settings')}><span className={`connection-dot ${store.user ? 'cloud-dot' : ''}`}/><span>{store.user ? 'Connected to your cloud' : 'Saved on this device'}</span><Settings2 size={14}/></button><a className="help-link" href={shortcutTemplateUrl} target="_blank" rel="noopener noreferrer"><Smartphone size={15}/> Install iPhone Shortcut <ArrowUpRight size={14}/></a><button className="help-link" onClick={() => setModal('help')}><HelpCircle size={15}/> How IdeaQueue works <ArrowUpRight size={14}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><span className="topbar-caption"><span className="tiny-star">✳</span> YOUR PERSONAL THINKING SPACE</span><div><span className="today">{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }).format(new Date())}</span><button className="icon-button" aria-label="Refresh notes" disabled={store.loading || busy} onClick={() => void store.refresh()}><RefreshCw size={17} className={store.loading ? 'spinning' : ''}/></button><button className="avatar" aria-label="Open account and storage settings" onClick={() => setModal('settings')}>{store.user?.email?.[0]?.toUpperCase() || 'P'}</button></div></header>
      <main>
        <div className="mobile-brand"><span><StickyNote size={20}/> ideaqueue.</span><button className="icon-button" aria-label="Settings" onClick={() => setModal('settings')}><Settings2 size={19}/></button></div>
        <section className="page-heading"><div><div className="eyebrow">A CLEARER MIND STARTS HERE</div><h1><span className="desktop-title">{screen === 'reviewed' ? 'Thoughts, taken further.' : 'Room for one thought.'}</span><span className="phone-title">{screen === 'reviewed' ? 'Reviewed' : 'Your idea box'}</span></h1><p>{screen === 'reviewed' ? 'Revisit or restore reviewed ideas. Choose their retention in Settings.' : 'Your highest-priority thought is ready. Pop it to move on.'}</p></div><button className="button capture-button" aria-label="Add idea" onClick={() => setModal('new')} disabled={busy || !store.ready}><Plus size={19}/> Add idea <span className="button-shortcut">⌘ K</span></button></section>
        <nav className="mobile-nav" aria-label="Mobile workspace"><button className={screen === 'queue' ? 'active' : ''} onClick={() => navigate('queue')}><Box size={15}/> Idea box <span>{active.length}</span></button><button className={screen === 'reviewed' ? 'active' : ''} onClick={() => navigate('reviewed')}><Check size={15}/> Reviewed <span>{reviewed.length}</span></button><select aria-label="Filter by bucket" value={bucket} disabled={busy} onChange={e => navigate('queue', e.target.value as Category | 'all')}><option value="all">All buckets</option>{categories.map(c => <option key={c}>{c}</option>)}</select></nav>
        {(store.error || (actionError && !modal)) && <div className="error-banner" role="alert">{store.error || actionError}<button onClick={() => { setActionError(''); void store.refresh(); }}>Retry</button></div>}
        {screen === 'queue' ? <section className="idea-section">
          <div className="section-heading"><div><h2>{bucket === 'all' ? 'Your idea box' : bucket}<span className="count-chip">{queueCount}</span></h2><span className="section-description">{queueCount} {queueCount === 1 ? 'thought waiting' : 'thoughts waiting'} · highest priority comes out first</span></div></div>
          <div className="idea-box pop-box">
            <div className="pop-stage">
              {store.loading && !store.ideas.length ? <div className="empty-box"><LoaderCircle className="spinning" size={30}/><h3>Opening your idea box...</h3></div> : focused ? <FocusNote idea={focused} now={clock} onEdit={() => setModal(focused)}/> : <div className="closed-box-state"><div className="closed-note-stack" aria-hidden="true"><span/><span/><span><StickyNote size={36}/></span></div><div className="eyebrow">OUT OF YOUR HEAD. SAFE IN HERE.</div><h3>Your idea box is empty.</h3><p>Use Add idea to put a thought in the box.</p></div>}
            </div>
            <div className="box-lip"><span className="box-label"><Box size={15}/>{bucket === 'all' ? 'THE IDEA BOX' : bucket.toUpperCase()}</span><span className="box-message">A little less to think about.</span><span className="box-rivet"/></div>
          </div>
          <div className="pop-actions"><div className="note-action-row"><button className="button pop-button" disabled={!queueCount || busy || !store.ready} onClick={() => void popNext()}>{busy ? <LoaderCircle size={17} className="spinning"/> : <ArrowDownToLine size={17}/>} <span className="desktop-pop-label">Pop next idea</span><span className="phone-pop-label">Pop idea</span></button>{focused && !busy ? <a className="button find-out-button" href={`https://www.google.com/search?${new URLSearchParams({ q: focused.text })}`} target="_blank" rel="noopener noreferrer" title="Search this idea on Google in a new browser tab">Find out <ArrowUpRight size={17}/></a> : <button className="button find-out-button" disabled title="No upcoming idea to search">Find out <ArrowUpRight size={17}/></button>}</div><p>{focused ? 'Pop this idea to save it in Reviewed and show the next.' : 'Your queue is empty for now.'}</p></div>
          <div className="workspace-status">{store.user ? <><Cloud size={13}/> Your private cloud workspace</> : <><span className="local-indicator"/> Saved in this browser · starts with 7 example notes</>}</div>
        </section> : <section className="idea-section reviewed-section"><div className="section-heading"><div><h2>The reviewed tray<span className="count-chip">{reviewed.length}</span></h2><span className="section-description">Revisit or restore your old ideas.</span></div></div>{reviewed.length ? <div className="reviewed-history">{reviewed.map(idea => <button key={idea.id} className="list-note" onClick={() => setModal(idea)}><span className={`list-note-icon note-${idea.color}`}><StickyNote size={22}/></span><span className="list-note-text"><strong>{idea.text}</strong><span>{idea.category} · Popped {captureTime(idea.reviewed_at!)}</span></span><ArrowUpRight size={17}/></button>)}</div> : <div className="empty-box reviewed-empty"><Check size={28}/><h3>A fresh tray, for now.</h3><p>Ideas appear here after you pop them out of the box.</p></div>}</section>}
        <footer className="page-footer"><span><Leaf size={14}/> Less in your head. More room to think.</span><button onClick={() => setModal('help')}>How it works <ArrowUpRight size={13}/></button></footer>
      </main>
    </div>
    <input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={e => void importFile(e.target.files?.[0])}/>
    <dialog ref={dialogRef} className="app-dialog" onCancel={() => setModal(null)} onClick={e => { if (e.target === dialogRef.current) setModal(null); }}><div className="dialog-content"><button className="icon-button dialog-close" aria-label="Close dialog" onClick={() => setModal(null)}><X size={21}/></button>
      {(modal === 'new' || (modal && typeof modal === 'object')) && <IdeaEditor key={typeof modal === 'object' ? modal.id : modal} idea={typeof modal === 'object' ? modal : undefined} busy={busy || !store.ready} onSave={idea => run(async () => { await store.save(idea, !!modal && typeof modal === 'object'); setModal(null); setToast('Saved in your idea box.'); })} onReview={idea => run(async () => { await store.save({ ...idea, reviewed_at: idea.reviewed_at ? null : new Date().toISOString() }, true); setModal(null); setToast(idea.reviewed_at ? 'Back in your box.' : 'Saved in Reviewed.'); })}/>}
      {modal === 'settings' && (store.hosted ? <HostedSettings email={store.user?.email} busy={busy} onMoveLocal={() => run(async () => { const count = await store.importNotes(readLocal() ?? []); setToast(`Moved ${count} browser notes online.`); })} onExport={() => exportIdeas(store.ideas)} onImport={() => importRef.current?.click()}/> : <AccountSettings email={store.user?.email} busy={busy || !store.ready} hourlyCleanup={store.hourlyCleanup} onCleanupChange={enabled => void run(() => store.setReviewedCleanup(enabled))} onSignOut={() => void run(async () => { const { error } = await supabase!.auth.signOut(); if (error) throw error; })} onExport={() => exportIdeas(store.ideas)} onImport={() => importRef.current?.click()}/>)}
      {modal === 'help' && <div className="help-content"><span className="dialog-kicker"><Box size={18}/> A LITTLE GUIDE</span><h2>One thought at a time.</h2><ol><li><strong>Add an idea.</strong><span>Use the one Add idea button to type or record a thought. Choose a bucket, or let the app suggest one. Context is yours to add.</span></li><li><strong>See what’s next.</strong><span>Your highest-priority idea is always shown. The rest stay in the box. Priority grows daily without rewriting your notes; starting priority breaks ties between adjusted days.</span></li><li><strong>Pop it when you’re ready.</strong><span>Pop moves the visible idea to Reviewed and immediately shows the next highest-priority idea. Find out searches the visible note. Reviewed clears hourly by default. Turn hourly cleanup off in Settings to keep each note for 7 days after review.</span></li></ol><p className="help-tip"><kbd>Ctrl / ⌘ K</kbd> opens the same Add idea dialog.</p><button className="button" onClick={() => setModal(null)}>Got it <Check size={16}/></button></div>}
      {actionError && <div className="dialog-error" role="alert">{actionError}</div>}
    </div></dialog>
    {toast && <div className="toast" role="status"><span><Check size={17}/></span>{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16}/></button></div>}
  </div>;
}

function IdeaEditor({ idea, busy, onSave, onReview }: { idea?: Idea; busy: boolean; onSave: (idea: Idea) => Promise<void>; onReview: (idea: Idea) => Promise<void> }) {
  const [text, setText] = useState(idea?.text ?? '');
  const [context, setContext] = useState(idea?.context ?? '');
  const [category, setCategory] = useState<Category | 'auto'>(idea?.category ?? 'auto');
  const [priority, setPriority] = useState(idea?.priority ?? 5);
  const [color, setColor] = useState<NoteColor>(idea?.color ?? 'yellow');
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
    const fields = createIdea({ text, context, category: category === 'auto' ? inferCategory(text) : category, priority, color });
    void onSave(idea ? { ...idea, ...fields, id: idea.id, created_at: idea.created_at, reviewed_at: idea.reviewed_at } : fields);
  };
  return <form className="idea-editor" onSubmit={submit} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit(); } }}>
    <span className="dialog-kicker"><StickyNote size={17}/> {idea ? 'A THOUGHT IN YOUR BOX' : 'MAKE A LITTLE ROOM'}</span><h2>{idea ? 'A second look.' : 'Add an idea.'}</h2><p>{idea ? 'Refine it, or put it back for another day.' : 'Type a thought, or use the microphone below.'}</p>
    <div className={`editor-paper note-${color}`}><textarea autoFocus aria-label="Idea text" placeholder="Start with a thought..." maxLength={2000} value={text} onChange={e => setText(e.target.value)} required rows={4}/><div className="paper-tools"><span>{text.length}/2000</span><button type="button" className={`voice-button ${listening ? 'listening' : ''}`} onClick={dictate} disabled={!speechSupported || voiceStatus === 'stopping'} title={speechSupported ? 'Transcribes with your browser’s speech service' : 'Voice capture is unavailable in this browser'}><Mic size={15}/>{listening ? 'Stop recording' : speechSupported ? 'Start recording' : 'Voice unavailable'}</button></div></div>
    {listening && <div className="dictation-feedback" role="status"><span className="recording-dot"/><div><strong>{voiceStatus === 'starting' ? 'Allow microphone access to begin.' : voiceStatus === 'stopping' ? 'Finishing your transcript...' : 'Listening... speak naturally.'}</strong>{interimText && <p>{interimText}</p>}</div></div>}
    {!speechSupported && <p className="voice-support">Voice capture is unavailable in this browser. Try a browser with speech recognition, or use your keyboard’s dictation.</p>}
    {voiceError && <div className="dialog-error" role="alert">{voiceError}</div>}
    {category === 'auto' && <p className="bucket-suggestion">Suggested bucket: <strong>{inferCategory(text)}</strong><span> · based on your note</span></p>}
    <details className="note-options"><summary>Bucket, priority & context <span>optional</span></summary>
    <label className="field-label">A little context <span>optional</span><textarea className="context-input" rows={2} maxLength={4000} placeholder="What would your future self need to know?" value={context} onChange={e => setContext(e.target.value)}/></label>
    <div className="editor-fields"><label className="field-label">Bucket<select aria-label="Bucket" value={category} onChange={e => setCategory(e.target.value as Category | 'auto')}><option value="auto">Choose automatically</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label className="field-label">Starting priority <span className="priority-number">{priority}/10</span><input type="range" min="1" max="10" value={priority} onChange={e => setPriority(Number(e.target.value))}/><span className="range-labels"><span>Whenever</span><span>Sooner</span></span></label></div>
    {idea && <p className="capture-stamp">Captured <time dateTime={idea.created_at}>{new Date(idea.created_at).toLocaleString()}</time></p>}
    <div className="color-selector"><span>Note color</span><div>{colors.map(c => <button type="button" key={c} className={`color-swatch note-${c} ${color === c ? 'chosen' : ''}`} aria-label={`${c} note`} aria-pressed={color === c} onClick={() => setColor(c)}>{color === c && <Check size={15}/>}</button>)}</div></div>
    </details><div className="editor-footer">{idea ? <button className="text-button" type="button" disabled={busy || listening} onClick={() => void onReview(idea)}>{idea.reviewed_at ? <RefreshCw size={16}/> : <ArrowDownToLine size={16}/>} {idea.reviewed_at ? 'Put back in the box' : 'Take this idea out'}</button> : <span className="editor-hint">Context stays blank unless you add it.</span>}<button className="button" type="submit" disabled={busy || listening || !text.trim()}>{busy ? <LoaderCircle size={16} className="spinning"/> : <Plus size={16}/>} {idea ? 'Save changes' : 'Drop it in'}</button></div>
  </form>;
}

function HostedSettings({ email, busy, onMoveLocal, onExport, onImport }: { email?: string; busy: boolean; onMoveLocal: () => Promise<void>; onExport: () => void; onImport: () => void }) {
  const [hasLocal] = useState(() => { try { return !!readLocal()?.length; } catch { return false; } });
  return <div className="settings-content"><span className="dialog-kicker"><Cloud size={18}/> YOUR PRIVATE BOX</span><h2>With you, everywhere.</h2><div className="storage-status"><span className="connection-dot cloud-dot"/><div><strong>Only your account can open this site</strong><span>{email || 'Signed in through Sites'}</span></div></div><p>Your notes are saved online. Open this same link on your phone or laptop to use the same box.</p>
    <div className="phone-install"><h3>Keep it on your Home Screen.</h3><p>On iPhone, open this link in Safari. Tap Share, then Add to Home Screen. Turn on Open as Web App if offered.</p></div>
    <details className="shortcut-help"><summary>Capture with iOS Shortcuts</summary><p>Use Dictate Text, then Get Contents of URL with POST and a JSON body. The server fills in the capture date and suggests a bucket when omitted.</p><code>{window.location.origin}/api/ideas</code><pre>{'{"text":"Your dictated thought","priority":5}'}</pre><p>Set Content-Type to application/json. Private API requests also need the owner service credential in the OAI-Sites-Authorization header: Bearer followed by your credential. Keep it in your personal Shortcut. A browser sign-in cookie will not authorize Shortcuts.</p><p>The capture API is ready. This app never displays or bundles the site credential; configure that privately before using the Shortcut.</p></details>
    <details className="backup-section"><summary>Backup & existing browser notes</summary><p>Exports include queued and reviewed notes. Imports add new IDs without replacing existing notes.</p><div><button className="secondary-button" onClick={onExport}><Download size={16}/> Export notes</button><button className="secondary-button" onClick={onImport} disabled={busy}><Upload size={16}/> Import notes</button>{hasLocal && <button className="secondary-button" disabled={busy} onClick={() => void onMoveLocal()}><Cloud size={16}/> Move this browser’s notes online</button>}</div></details><a className="text-button signout-link" href="/signout-with-chatgpt?return_to=%2F" target="_top"><LogOut size={16}/> Sign out</a>
  </div>;
}
