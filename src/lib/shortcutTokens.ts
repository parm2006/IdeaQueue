import { supabase } from './supabase';

export interface ShortcutToken {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
export interface CreatedShortcutToken extends ShortcutToken { token: string }
function client() {
  if (!supabase) throw new Error('Connect Supabase before setting up Shortcuts.');
  return supabase;
}

export async function listShortcutTokens(): Promise<ShortcutToken[]> {
  const { data, error } = await client().rpc('list_shortcut_tokens');
  if (error) throw new Error('Could not load Shortcut tokens. Check that shortcuts.sql has been installed.');
  return data ?? [];
}

/** The database generates 256 random bits. Show this once; never save it in browser storage. */
export async function createShortcutToken(label = 'iPhone Shortcut'): Promise<CreatedShortcutToken> {
  const { data, error } = await client().rpc('create_shortcut_token', { p_label: label.trim() });
  if (error) throw new Error('Could not create a Shortcut token. Sign in and check the database setup.');
  const created = data?.[0];
  if (!created?.token) throw new Error('The database did not return a capture token.');
  return created;
}

export async function revokeShortcutToken(id: string): Promise<boolean> {
  const { data, error } = await client().rpc('revoke_shortcut_token', { p_id: id });
  if (error) throw new Error('Could not revoke the Shortcut token.');
  return data === true;
}
