import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Base surface used across the dashboard and builder for grouped content. */
export function Card({ title, eyebrow, action, children, className = "" }: CardProps) {
  return (
    <div
      className={`animate-rise-in rounded-2xl border border-border bg-surface/80 p-5 shadow-lg shadow-black/20 backdrop-blur-sm sm:p-6 ${className}`}
    >
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {eyebrow && (
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-faint">{eyebrow}</p>
            )}
            {title && <h3 className="text-base font-semibold text-ink">{title}</h3>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
