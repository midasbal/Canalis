export type BlockCategory = "trigger" | "condition" | "action";

const CATEGORY_STYLES: Record<BlockCategory, { border: string; dot: string; bg: string }> = {
  trigger: { border: "border-trigger/40", dot: "bg-trigger", bg: "bg-trigger-soft" },
  condition: { border: "border-condition/40", dot: "bg-condition", bg: "bg-condition-soft" },
  action: { border: "border-action/40", dot: "bg-action", bg: "bg-action-soft" },
};

interface FlowBlockProps {
  category: BlockCategory;
  label: string;
  description: string;
}

/** A single trigger/condition/action block in the palette, color-coded by category. */
export function FlowBlock({ category, label, description }: FlowBlockProps) {
  const styles = CATEGORY_STYLES[category];

  return (
    <div
      className={`group flex flex-col gap-1 rounded-xl border ${styles.border} ${styles.bg} px-3.5 py-3 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/20`}
      title={description}
    >
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
        <span className="text-sm font-medium text-ink">{label}</span>
      </div>
      <p className="text-xs leading-snug text-ink-muted">{description}</p>
    </div>
  );
}
