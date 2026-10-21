import { useState } from 'react';
import { UserRound } from 'lucide-react';
import type { WorkspaceUser } from '../lib/hosted';

export function AccountAvatar({ user, label, onOpen }: { user: WorkspaceUser | null; label: string; onOpen: () => void }) {
  const [failedUrl, setFailedUrl] = useState('');
  const candidate = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const photo = typeof candidate === 'string' && candidate.startsWith('https://') ? candidate : '';
  return <button className="avatar account-avatar" aria-label={`${label}${user?.email ? ` (${user.email})` : ''}`}
    title={user?.email || 'Account settings'} onClick={onOpen}>
    {photo && photo !== failedUrl ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(photo)}/>
      : <UserRound size={19} aria-hidden="true"/>}
  </button>;
}
