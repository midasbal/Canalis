import { CONDITION_KIND_LABELS, emptyCondition, newAddressRow, type ComposerCondition, type ConditionKind } from "../../lib/composer";
import { AddressField, AmountField, Field, RemoveButton } from "./inputs";

const CONDITION_KINDS: ConditionKind[] = ["amountCap", "minBalance", "cooldown", "timeWindow", "allowList", "denyList"];

interface ConditionsSectionProps {
  conditions: ComposerCondition[];
  onChange: (conditions: ComposerCondition[]) => void;
}

/** Stage 1, section 2: add zero or more guard conditions, each its own removable card. */
export function ConditionsSection({ conditions, onChange }: ConditionsSectionProps) {
  function addCondition(kind: ConditionKind) {
    onChange([...conditions, emptyCondition(kind)]);
  }

  function updateCondition(id: string, patch: Partial<ComposerCondition>) {
    onChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeCondition(id: string) {
    onChange(conditions.filter((c) => c.id !== id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {CONDITION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => addCondition(kind)}
            className="rounded-full border border-condition/30 bg-condition-soft px-3 py-1.5 text-xs font-medium text-condition transition-colors duration-200 hover:border-condition/50"
          >
            + {CONDITION_KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      {conditions.length === 0 ? (
        <p className="text-xs text-ink-faint">No conditions — the flow runs whenever its trigger fires, unguarded.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {conditions.map((condition) => (
            <ConditionCard
              key={condition.id}
              condition={condition}
              onChange={(patch) => updateCondition(condition.id, patch)}
              onRemove={() => removeCondition(condition.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionCard({
  condition,
  onChange,
  onRemove,
}: {
  condition: ComposerCondition;
  onChange: (patch: Partial<ComposerCondition>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-condition/25 bg-surface/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-condition">{CONDITION_KIND_LABELS[condition.kind]}</span>
        <RemoveButton onClick={onRemove} label={`Remove ${CONDITION_KIND_LABELS[condition.kind]} condition`} />
      </div>

      {condition.kind === "amountCap" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AmountField label="Minimum (USDC)" value={condition.minAmount} onChange={(e) => onChange({ minAmount: e.target.value })} />
          <AmountField label="Maximum (USDC)" value={condition.maxAmount} onChange={(e) => onChange({ maxAmount: e.target.value })} />
        </div>
      )}

      {condition.kind === "minBalance" && (
        <AmountField
          label="Account must hold at least (USDC)"
          value={condition.minBalance}
          onChange={(e) => onChange({ minBalance: e.target.value })}
        />
      )}

      {condition.kind === "cooldown" && (
        <Field
          label="Minimum seconds since this flow last ran"
          value={condition.cooldownSeconds}
          onChange={(e) => onChange({ cooldownSeconds: e.target.value })}
          placeholder="e.g. 300"
          inputMode="numeric"
        />
      )}

      {condition.kind === "timeWindow" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Window start"
            type="datetime-local"
            value={condition.windowStart}
            onChange={(e) => onChange({ windowStart: e.target.value })}
          />
          <Field
            label="Window end"
            type="datetime-local"
            value={condition.windowEnd}
            onChange={(e) => onChange({ windowEnd: e.target.value })}
          />
        </div>
      )}

      {(condition.kind === "allowList" || condition.kind === "denyList") && (
        <RecipientListEditor
          recipients={condition.recipients}
          onChange={(recipients) => onChange({ recipients })}
          addLabel="+ Address"
        />
      )}
    </div>
  );
}

function RecipientListEditor({
  recipients,
  onChange,
  addLabel,
}: {
  recipients: ComposerCondition["recipients"];
  onChange: (recipients: ComposerCondition["recipients"]) => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {recipients.map((row) => (
        <div key={row.id} className="flex items-end gap-2">
          <div className="flex-1">
            <AddressField
              label=""
              value={row.address}
              onChange={(e) => onChange(recipients.map((r) => (r.id === row.id ? { ...r, address: e.target.value } : r)))}
            />
          </div>
          <RemoveButton onClick={() => onChange(recipients.filter((r) => r.id !== row.id))} label="Remove address" />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...recipients, newAddressRow()])}
        className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-ink-muted transition-colors duration-200 hover:border-ink-faint"
      >
        {addLabel}
      </button>
    </div>
  );
}
