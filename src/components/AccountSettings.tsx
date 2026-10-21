import { Download, LogOut, Trash2, Upload } from 'lucide-react';
import { bucketColors, type Category } from '../lib/queue';
import { LegalLinks } from './LegalLinks';
import { ShortcutSettings } from './ShortcutSettings';
import { ReviewedRetention } from './ReviewedRetention';

export function AccountSettings({ email, busy, hourlyCleanup, buckets, onDeleteBucket, onCleanupChange, onSignOut, onExport, onImport }: {
  email?: string; busy: boolean; hourlyCleanup: boolean; onCleanupChange: (enabled: boolean) => void; onSignOut: () => void; onExport: () => void; onImport: () => void;
  buckets: Category[]; onDeleteBucket: (category: Category) => void;
}) {
  return <div className="settings-content"><h2>Settings</h2>
    <div className="storage-status"><span className="connection-dot cloud-dot"/><div><strong>Your Google account</strong><span>{email}</span></div></div>
    <p>Your notes sync through your private account. Other accounts have their own idea boxes.</p>
    <div className="phone-install"><h3>Add to Home Screen</h3><p>On iPhone, open this link in Safari. Tap Share, then Add to Home Screen. Turn on Open as Web App if offered.</p></div>
    <ReviewedRetention hourlyCleanup={hourlyCleanup} disabled={busy} onChange={onCleanupChange}/>
    <details className="bucket-settings"><summary>Buckets</summary><p>Deleting a bucket moves its queued and reviewed notes to General.</p>
      {buckets.map(category => <div className="bucket-settings-row" key={category}><span className={`bucket-dot note-${bucketColors[category]}`} aria-hidden="true"/><span>{category}</span>{category !== 'General' && <button className="icon-button" aria-label={`Delete ${category} bucket`} disabled={busy} onClick={() => onDeleteBucket(category)}><Trash2 size={17}/></button>}</div>)}
    </details>
    <ShortcutSettings/>
    <LegalLinks/>
    <div className="backup-section"><h3>Backup</h3><p>Export queued and reviewed notes. Import adds new notes without replacing existing ones.</p><div><button className="secondary-button" onClick={onExport}><Download size={16}/> Export notes</button><button className="secondary-button" onClick={onImport} disabled={busy}><Upload size={16}/> Import notes</button></div></div>
    <button className="text-button signout-link" onClick={onSignOut} disabled={busy}><LogOut size={16}/> Sign out</button>
  </div>;
}
