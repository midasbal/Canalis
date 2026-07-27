import type { ReactNode } from "react";
import { Badge } from "./Badge";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  detail: string;
}

/** Intentional "not implemented yet" state — never dressed up as live data. */
export function EmptyState({ icon, title, detail }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-ink-faint">{icon}</div>
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-sm font-medium text-ink-muted">{title}</p>
        <Badge tone="warning">Coming soon</Badge>
      </div>
      <p className="max-w-xs text-xs text-ink-faint">{detail}</p>
    </div>
  );
}
