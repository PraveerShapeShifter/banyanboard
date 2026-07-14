/**
 * Shared loading indicator, reused by both pages. The visible "Loading…" text
 * is the accessible cue (the spinner graphic is decorative, `aria-hidden`); the
 * region is `aria-live="polite"` so screen readers announce the transition.
 */
export default function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
