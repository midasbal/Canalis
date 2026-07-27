import { TriggerType } from "../../lib/flows";
import type { ComposerTrigger } from "../../lib/composer";
import { Field, AmountField } from "./inputs";

const TRIGGER_OPTIONS: { kind: TriggerType; label: string; description: string }[] = [
  { kind: TriggerType.Manual, label: "Manual", description: "Fires only when you click \"Run now\"." },
  { kind: TriggerType.OnSchedule, label: "On schedule", description: "Fires once or on a recurring interval." },
  { kind: TriggerType.OnThreshold, label: "On threshold", description: "Fires when the account balance is ≥ an amount." },
  { kind: TriggerType.OnReceive, label: "On receive", description: "Fires when USDC lands in the account." },
];

interface TriggerSectionProps {
  trigger: ComposerTrigger;
  onChange: (trigger: ComposerTrigger) => void;
}

/** Stage 1, section 1: pick exactly one trigger, then fill only the fields it needs. */
export function TriggerSection({ trigger, onChange }: TriggerSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TRIGGER_OPTIONS.map((option) => {
          const selected = trigger.kind === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              onClick={() => onChange({ ...trigger, kind: option.kind })}
              className={`flex flex-col gap-0.5 rounded-xl border px-3.5 py-3 text-left transition-colors duration-200 ${
                selected ? "border-trigger/50 bg-trigger-soft" : "border-border bg-surface hover:border-trigger/30"
              }`}
            >
              <span className={`flex items-center gap-2 text-sm font-medium ${selected ? "text-trigger" : "text-ink"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${selected ? "bg-trigger" : "bg-ink-faint"}`} />
                {option.label}
              </span>
              <span className="text-xs leading-snug text-ink-muted">{option.description}</span>
            </button>
          );
        })}
      </div>

      {trigger.kind === TriggerType.OnSchedule && (
        <div className="flex flex-col gap-3 rounded-xl border border-border-soft bg-surface/50 p-4">
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scheduleMode"
                checked={trigger.scheduleMode === "now"}
                onChange={() => onChange({ ...trigger, scheduleMode: "now" })}
              />
              <span className="text-ink">Start now</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scheduleMode"
                checked={trigger.scheduleMode === "custom"}
                onChange={() => onChange({ ...trigger, scheduleMode: "custom" })}
              />
              <span className="text-ink">Pick a first-run time</span>
            </label>
          </div>
          {trigger.scheduleMode === "custom" && (
            <Field
              label="First run"
              type="datetime-local"
              value={trigger.scheduleAt}
              onChange={(e) => onChange({ ...trigger, scheduleAt: e.target.value })}
            />
          )}
          <Field
            label="Repeat every (seconds) — blank or 0 for one-time"
            value={trigger.intervalSeconds}
            onChange={(e) => onChange({ ...trigger, intervalSeconds: e.target.value })}
            placeholder="e.g. 3600 for hourly"
            inputMode="numeric"
          />
        </div>
      )}

      {trigger.kind === TriggerType.OnThreshold && (
        <div className="rounded-xl border border-border-soft bg-surface/50 p-4">
          <AmountField
            label="Threshold amount (USDC) — fires when balance is ≥ this"
            value={trigger.thresholdAmount}
            onChange={(e) => onChange({ ...trigger, thresholdAmount: e.target.value })}
          />
          <p className="mt-2 text-xs text-ink-faint">
            Only the "at or above" direction is supported by the engine — there's no "below" option.
          </p>
        </div>
      )}

      {trigger.kind === TriggerType.OnReceive && (
        <p className="text-xs text-ink-faint">
          No extra fields — this flow becomes eligible to run once, each time new USDC is deposited into the account.
        </p>
      )}

      {trigger.kind === TriggerType.Manual && (
        <p className="text-xs text-ink-faint">No extra fields — only you can run this, from the deployed-flows list.</p>
      )}
    </div>
  );
}
