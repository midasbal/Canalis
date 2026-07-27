/**
 * Canalis brand mark: one channel in, split into three routed paths.
 * Inlined from brand/canalis-icon.svg (source of truth for the asset) so it
 * renders crisply with no extra request. Fixed brand colors, not theme vars —
 * this is the logo, not a themed icon.
 */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="Canalis" className={className}>
      <g fill="none" stroke="#7C5CFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 32 H30" />
        <path d="M30 32 C39 32 42 15 50 15" />
        <path d="M30 32 H50" />
        <path d="M30 32 C39 32 42 49 50 49" />
      </g>
      <circle cx="14" cy="32" r="3.4" fill="#7C5CFF" />
      <circle cx="30" cy="32" r="3.4" fill="#7C5CFF" />
      <circle cx="50" cy="15" r="4" fill="#A78BFA" />
      <circle cx="50" cy="32" r="4" fill="#A78BFA" />
      <circle cx="50" cy="49" r="4" fill="#A78BFA" />
    </svg>
  );
}
