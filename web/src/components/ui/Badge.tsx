import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warning";
}

/** Small status label — used for honest "not yet implemented" markers. */
export function Badge({ children, tone = "neutral" }: BadgeProps) {
  const tones: Record<NonNullable<BadgeProps["tone"]>, string> = {
    neutral: "bg-white/5 text-brand-muted border-brand-bronze/25",
    accent: "bg-brand-violet/15 text-brand-violet-soft border-brand-violet/30",
    warning: "bg-condition-soft text-condition border-condition/30",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
