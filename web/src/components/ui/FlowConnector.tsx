/** Directional connector used between palette columns / example-flow steps. */
export function FlowConnector({ vertical = false }: { vertical?: boolean }) {
  if (vertical) {
    return (
      <div className="flex justify-center py-1 sm:hidden">
        <svg width="16" height="24" viewBox="0 0 16 24" fill="none" className="text-ink-faint">
          <path d="M8 0v18" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
          <path d="M3 15l5 6 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div className="hidden items-center px-1 sm:flex">
      <svg width="28" height="16" viewBox="0 0 28 16" fill="none" className="text-ink-faint">
        <path d="M0 8h20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
        <path d="M15 3l6 5-6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
