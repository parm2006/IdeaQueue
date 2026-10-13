import { Cloud, Download, LogOut, Upload } from 'lucide-react';
import { ShortcutSettings } from './ShortcutSettings';
import { ReviewedRetention } from './ReviewedRetention';

export function AccountSettings({ email, busy, hourlyCleanup, onCleanupChange, onSignOut, onExport, onImport }: {
  email?: string; busy: boolean; hourlyCleanup: boolean; onCleanupChange: (enabled: boolean) => void; onSignOut: () => void; onExport: () => void; onImport: () => void;
}) {
  return <div className="settings-content"><span className="dialog-kicker"><Cloud size={18}/> YOUR PRIVATE BOX</span><h2>With you, everywhere.</h2>
    <div className="storage-status"><span className="connection-dot cloud-dot"/><div><strong>Your Google account</strong><span>{email}</span></div></div>
    <p>Your notes sync through your private account. Other accounts have their own idea boxes.</p>
    <div className="phone-install"><h3>Keep it on your Home Screen.</h3><p>On iPhone, open this link in Safari. Tap Share, then Add to Home Screen. Turn on Open as Web App if offered.</p></div>
    <ReviewedRetention hourlyCleanup={hourlyCleanup} disabled={busy} onChange={onCleanupChange}/>
    <ShortcutSettings/>
    <div className="backup-section"><h3>Keep a little backup.</h3><p>Export queued and reviewed notes. Import adds new notes without replacing existing ones.</p><div><button className="secondary-button" onClick={onExport}><Download size={16}/> Export notes</button><button className="secondary-button" onClick={onImport} disabled={busy}><Upload size={16}/> Import notes</button></div></div>
    <button className="text-button signout-link" onClick={onSignOut} disabled={busy}><LogOut size={16}/> Sign out</button>
  </div>;
}
