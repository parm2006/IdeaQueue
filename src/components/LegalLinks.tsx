export function LegalLinks() {
  return <nav aria-label="Information" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
    <a className="text-button" href="/privacy.html">Privacy</a>
    <a className="text-button" href="/accessibility.html">Accessibility</a>
    <a className="text-button" href="/terms.html">Terms</a>
  </nav>;
}
