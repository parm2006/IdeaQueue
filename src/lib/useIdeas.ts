import { useCallback, useEffect, useRef, useState } from 'react';
import { hosted, workspaceApi, type WorkspaceUser } from './hosted';
import { supabase } from './supabase';
import { categories, type Category, type Idea } from './queue';

const columns = 'id,text,context,category,priority,color,created_at,reviewed_at';

export function useIdeas() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [user, setUser] = useState<WorkspaceUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [hourlyCleanup, setHourlyCleanup] = useState(true);
  const [deletedBuckets, setDeletedBuckets] = useState<Category[]>([]);
  const userRef = useRef<WorkspaceUser | null>(null);
  const loadVersion = useRef(0);
  const workspaceEpoch = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError(''); setReady(false);
    try {
      let next: Idea[] = [];
      let nextHourlyCleanup = true;
      let nextDeletedBuckets: Category[] = [];
      if (hosted) {
        const session = await workspaceApi<{ user: WorkspaceUser }>('session');
        userRef.current = session.user; setUser(session.user);
        next = (await workspaceApi<{ ideas: Idea[] }>('ideas')).ideas;
      } else if (supabase && userRef.current) {
        const [notes, settings] = await Promise.all([
          supabase.from('ideas').select(columns).order('created_at', { ascending: false }),
          supabase.from('ideaqueue_settings').select('hourly_cleanup,deleted_buckets').eq('user_id', userRef.current.id).maybeSingle(),
        ]);
        const { data, error } = notes;
        if (error) throw error;
        if (settings.error) throw settings.error;
        nextHourlyCleanup = settings.data?.hourly_cleanup ?? true;
        nextDeletedBuckets = settings.data?.deleted_buckets ?? [];
        next = data as Idea[];
      }
      if (version === loadVersion.current) { setIdeas(next); setHourlyCleanup(nextHourlyCleanup); setDeletedBuckets(nextDeletedBuckets); setReady(!!userRef.current); }
    } catch (e) {
      if (version === loadVersion.current) setError((e as { message?: string })?.message || 'Could not load notes. Check your connection and retry.');
    } finally { if (version === loadVersion.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (hosted || !supabase) { void refresh(); return; }
    let alive = true;
    const changeUser = (next: WorkspaceUser | null) => {
      if (userRef.current?.id !== next?.id) {
        workspaceEpoch.current++; loadVersion.current++;
        setIdeas([]); setHourlyCleanup(true); setDeletedBuckets([]); setReady(false);
      }
      userRef.current = next; setUser(next);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      changeUser(session?.user ?? null);
      // Leave the auth callback before making database requests.
      window.setTimeout(() => { if (alive) void refresh(); }, 0);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) { setError(error.message); setLoading(false); return; }
      changeUser(data.session?.user ?? null); void refresh();
    }).catch(() => { if (alive) { setError('Sign-in could not be initialized.'); setLoading(false); } });
    return () => { alive = false; subscription.unsubscribe(); loadVersion.current++; };
  }, [refresh]);

  const hasReviewed = ideas.some(idea => idea.reviewed_at);
  useEffect(() => {
    if (hosted || !hasReviewed) return;
    const timer = window.setInterval(() => {
      if (userRef.current && document.visibilityState === 'visible') void refresh();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [hasReviewed, refresh]);

  useEffect(() => {
    const focus = () => { if (hosted || userRef.current) void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);

  const requireUser = () => {
    if (!ready || !userRef.current) throw new Error('Sign in and wait for your notes to load, then retry.');
    return userRef.current;
  };
  const checkEpoch = (epoch: number) => {
    if (epoch !== workspaceEpoch.current) throw new Error('Your account changed. Reopen your workspace to check your notes.');
  };

  const save = async (idea: Idea, editing = false) => {
    const owner = requireUser();
    const epoch = workspaceEpoch.current;
    let result: Idea;
    if (hosted) result = (await workspaceApi<{ idea: Idea }>('ideas', idea, 'PUT')).idea;
    else {
      if (!supabase) throw new Error('Cloud storage is unavailable.');
      const row = { ...idea, user_id: owner.id };
      const existing = editing || ideas.some(current => current.id === idea.id);
      const write = existing
        ? supabase.from('ideas').update(row).eq('id', idea.id)
        : supabase.from('ideas').insert(row);
      const { data, error } = await write.select(columns).single();
      if (error?.code === 'PGRST116') {
        await refresh();
        throw new Error('This idea is no longer available. It may have been cleared from Reviewed.');
      }
      if (error) throw error;
      result = data as Idea;
    }
    checkEpoch(epoch);
    setIdeas(current => current.some(i => i.id === result.id) ? current.map(i => i.id === result.id ? result : i) : [...current, result]);
  };

  const setReviewedCleanup = async (enabled: boolean) => {
    const owner = requireUser();
    const epoch = workspaceEpoch.current;
    if (!supabase || hosted) throw new Error('Reviewed cleanup settings are available on the Supabase app.');
    const { error } = await supabase.from('ideaqueue_settings').upsert({ user_id: owner.id, hourly_cleanup: enabled });
    if (error) throw error;
    checkEpoch(epoch);
    await refresh();
  };

  const deleteBucket = async (category: Category) => {
    requireUser();
    const epoch = workspaceEpoch.current;
    if (!supabase || hosted) throw new Error('Bucket settings are available on the Supabase app.');
    const { error } = await supabase.rpc('delete_idea_bucket', { p_category: category });
    if (error) throw error;
    checkEpoch(epoch);
    await refresh();
  };

  const pop = async (category?: Category, expectedId?: string) => {
    requireUser();
    const epoch = workspaceEpoch.current;
    try {
      let popped: Idea | undefined;
      if (hosted) popped = (await workspaceApi<{ idea: Idea | null }>('pop', { category, expected_id: expectedId })).idea ?? undefined;
      else {
        if (!supabase) throw new Error('Cloud storage is unavailable.');
        const { data, error } = await supabase.rpc('pop_idea', { p_category: category ?? null, p_expected_id: expectedId ?? null });
        if (error) throw error;
        popped = (data as Idea[])?.[0];
      }
      checkEpoch(epoch); await refresh(); return popped;
    } catch (error) { await refresh(); throw error; }
  };

  const importNotes = async (incoming: Idea[]) => {
    const owner = requireUser();
    const epoch = workspaceEpoch.current;
    const newNotes = incoming.filter(i => !ideas.some(existing => existing.id === i.id));
    if (!newNotes.length) return 0;
    let total = 0;
    try {
      for (let start = 0; start < newNotes.length; start += 100) {
        checkEpoch(epoch);
        const batch = newNotes.slice(start, start + 100);
        if (hosted) total += (await workspaceApi<{ inserted: number }>('import', batch)).inserted;
        else {
          if (!supabase) throw new Error('Cloud storage is unavailable.');
          const { error } = await supabase.from('ideas').upsert(batch.map(i => ({ ...i, user_id: owner.id })), { onConflict: 'id', ignoreDuplicates: true });
          if (error) throw error;
          total += batch.length;
        }
      }
      checkEpoch(epoch); await refresh(); return total;
    } catch (error) {
      await refresh();
      throw new Error(`${total} notes submitted. Retry to add the rest. ${(error as { message?: string })?.message || ''}`);
    }
  };

  return { ideas, user, loading, ready, error, refresh, save, pop, importNotes, hosted, hourlyCleanup, setReviewedCleanup,
    buckets: categories.filter(category => !deletedBuckets.includes(category)), deleteBucket };
}
