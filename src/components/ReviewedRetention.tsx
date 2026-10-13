export function ReviewedRetention({ hourlyCleanup, disabled, onChange }: {
  hourlyCleanup: boolean; disabled: boolean; onChange: (enabled: boolean) => void;
}) {
  return <div className="reviewed-retention">
    <h3>Reviewed cleanup</h3>
    <label><input type="checkbox" checked={hourlyCleanup} disabled={disabled} onChange={event => onChange(event.target.checked)}/><span>Delete reviewed ideas every hour</span></label>
    <p>{hourlyCleanup
      ? 'Your reviewed ideas are deleted at the next hourly cleanup. Restore one to keep it.'
      : 'Hourly deletion is off. Each idea is deleted after 7 days in Reviewed, on the next hourly cleanup pass.'}</p>
    <p className="retention-rule">Turning this off keeps reviewed ideas for a week, not forever. The 7 days start when you review an idea, regardless of when it was created. Pending ideas are kept.</p>
  </div>;
}
