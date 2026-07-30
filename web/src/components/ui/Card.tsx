import type { ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** "default" is the primary heavy treatment; "flat" is a lighter, quieter surface for secondary/helper sections so the page isn't a uniform stack of identical boxes. */
  variant?: "default" | "flat";
}

/** Base surface used across the dashboard and builder for grouped content. */
export function Card({ title, eyebrow, action, children, className = "", variant = "default" }: CardProps) {
  const surface =
    variant === "flat"
      ? "rounded-xl border border-brand-bronze/12 bg-brand-surface/40 p-4 sm:p-5"
      : "rounded-2xl border border-brand-bronze/20 bg-brand-surface/80 p-5 shadow-lg shadow-black/20 backdrop-blur-sm sm:p-6";

  return (
    <div className={`animate-rise-in ${surface} ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {eyebrow && (
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-brand-muted/70">{eyebrow}</p>
            )}
            {title && <h3 className="flex items-center gap-1.5 text-base font-semibold text-brand-ink">{title}</h3>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
