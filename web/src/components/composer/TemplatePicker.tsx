import { FLOW_TEMPLATES } from "../../lib/templates";
import type { ComposerDraft } from "../../lib/composer";

interface TemplatePickerProps {
  onPick: (draft: ComposerDraft) => void;
}

/** Stage 4: one-click templates that pre-fill the composer with a real, valid starting flow. */
export function TemplatePicker({ onPick }: TemplatePickerProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {FLOW_TEMPLATES.map((template) => (
        <button
          key={template.id}
          type="button"
          onClick={() => onPick(template.build())}
          className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors duration-200 hover:border-accent/40 hover:bg-accent-soft"
        >
          <span className="text-sm font-medium text-ink">{template.name}</span>
          <span className="text-xs leading-snug text-ink-muted">{template.description}</span>
        </button>
      ))}
    </div>
  );
}
