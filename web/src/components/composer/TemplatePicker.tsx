import { FLOW_TEMPLATES } from "../../lib/templates";
import type { ComposerDraft } from "../../lib/composer";

interface TemplatePickerProps {
  /** The currently selected template's id, or null if none picked yet / the draft was reset — see FlowComposer. */
  selectedId: string | null;
  onPick: (draft: ComposerDraft, templateId: string) => void;
}

/** Stage 4: one-click templates that pre-fill the composer with a real, valid starting flow. Clicking one highlights it (accent border/background) until a different template is picked or the composer is reset. */
export function TemplatePicker({ selectedId, onPick }: TemplatePickerProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {FLOW_TEMPLATES.map((template) => {
        const selected = template.id === selectedId;
        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onPick(template.build(), template.id)}
            aria-pressed={selected}
            className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-colors duration-200 ${
              selected ? "border-accent/60 bg-accent-soft" : "border-border bg-surface hover:border-accent/40 hover:bg-accent-soft"
            }`}
          >
            <span className={`text-sm font-medium ${selected ? "text-accent-strong" : "text-ink"}`}>{template.name}</span>
            <span className="text-xs leading-snug text-ink-muted">{template.description}</span>
          </button>
        );
      })}
    </div>
  );
}
