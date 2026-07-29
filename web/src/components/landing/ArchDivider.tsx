import { useId } from "react";

/**
 * A quiet row of thin arch shapes marking a section break, echoing the
 * aqueduct's own repeating arches. Purely decorative, static (no
 * animation), bronze hairline only. `useId` keeps each instance's SVG
 * pattern id unique so multiple dividers on one page don't collide (an
 * `url(#id)` reference resolves to the first matching id in the document
 * otherwise).
 */
export function ArchDivider({ className = "" }: { className?: string }) {
  const patternId = `arch-divider-${useId()}`;

  return (
    <div aria-hidden="true" className={`mx-auto max-w-5xl px-5 sm:px-8 ${className}`}>
      <svg viewBox="0 0 600 28" preserveAspectRatio="none" className="h-5 w-full opacity-25 sm:h-6">
        <defs>
          <pattern id={patternId} width="50" height="28" patternUnits="userSpaceOnUse">
            <path d="M0 28 V14 A11 11 0 0 1 22 14 V28" fill="none" stroke="var(--color-brand-bronze)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="600" height="28" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
