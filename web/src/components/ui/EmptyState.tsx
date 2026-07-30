import type { ReactNode } from "react";
import { Badge } from "./Badge";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  detail?: string;
  /** Defaults to a "Coming soon" badge (the original not-implemented-yet marker) — pass `null` to omit it for a genuinely actionable empty state. */
  badge?: ReactNode;
  /** Optional real call to action rendered below the copy (e.g. a link to the Builder). */
  action?: ReactNode;
}

/** Empty/placeholder state — either an honest "not implemented yet" marker, or a real actionable empty state (badge omitted). */
export function EmptyState({ icon, title, detail, badge = <Badge tone="warning">Coming soon</Badge>, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-brand-bronze/25 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-brand-muted">{icon}</div>
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-sm font-medium text-brand-muted">{title}</p>
        {badge}
      </div>
      {detail && <p className="max-w-xs text-xs text-brand-muted/70">{detail}</p>}
      {action}
    </div>
  );
}
