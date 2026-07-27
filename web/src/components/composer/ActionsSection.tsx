import { ActionType } from "../../lib/flows";
import { ACTION_KIND_LABELS, emptyAction, newSplitRecipientRow, type ComposerAction } from "../../lib/composer";
import { AddressField, AmountField, Field, RemoveButton } from "./inputs";

const ACTION_KINDS: ActionType[] = [ActionType.Forward, ActionType.Split, ActionType.Sweep, ActionType.LockRelease];

interface ActionsSectionProps {
  actions: ComposerAction[];
  onChange: (actions: ComposerAction[]) => void;
}

/** Stage 1, section 3: add one or more actions, each its own removable card, run atomically in order. */
export function ActionsSection({ actions, onChange }: ActionsSectionProps) {
  function addAction(kind: ActionType) {
    onChange([...actions, emptyAction(kind)]);
  }

  function updateAction(id: string, patch: Partial<ComposerAction>) {
    onChange(actions.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function removeAction(id: string) {
    onChange(actions.filter((a) => a.id !== id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {ACTION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => addAction(kind)}
            className="rounded-full border border-action/30 bg-action-soft px-3 py-1.5 text-xs font-medium text-action transition-colors duration-200 hover:border-action/50"
          >
            + {ACTION_KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      {actions.length === 0 ? (
        <p className="text-xs text-ink-faint">Add at least one action — a flow that does nothing can't be deployed.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {actions.map((action, index) => (
            <ActionCard
              key={action.id}
              index={index}
              action={action}
              onChange={(patch) => updateAction(action.id, patch)}
              onRemove={() => removeAction(action.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionCard({
  index,
  action,
  onChange,
  onRemove,
}: {
  index: number;
  action: ComposerAction;
  onChange: (patch: Partial<ComposerAction>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-action/25 bg-surface/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-action">
          {index + 1}. {ACTION_KIND_LABELS[action.kind]}
        </span>
        <RemoveButton onClick={onRemove} label={`Remove ${ACTION_KIND_LABELS[action.kind]} action`} />
      </div>

      {action.kind === ActionType.Forward && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AddressField label="Recipient" value={action.forwardRecipient} onChange={(e) => onChange({ forwardRecipient: e.target.value })} />
          <AmountField label="Amount (USDC)" value={action.forwardAmount} onChange={(e) => onChange({ forwardAmount: e.target.value })} />
        </div>
      )}

      {action.kind === ActionType.Split && <SplitEditor action={action} onChange={onChange} />}

      {action.kind === ActionType.Sweep && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AddressField label="Destination" value={action.sweepDestination} onChange={(e) => onChange({ sweepDestination: e.target.value })} />
          <AmountField
            label="Leave behind (USDC) — sweeps everything above this"
            value={action.sweepThreshold}
            onChange={(e) => onChange({ sweepThreshold: e.target.value })}
          />
        </div>
      )}

      {action.kind === ActionType.LockRelease && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AddressField label="Recipient" value={action.lockRecipient} onChange={(e) => onChange({ lockRecipient: e.target.value })} />
          <AmountField label="Amount (USDC)" value={action.lockAmount} onChange={(e) => onChange({ lockAmount: e.target.value })} />
          <Field
            label="Releasable at"
            type="datetime-local"
            value={action.lockReleaseAt}
            onChange={(e) => onChange({ lockReleaseAt: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

function SplitEditor({ action, onChange }: { action: ComposerAction; onChange: (patch: Partial<ComposerAction>) => void }) {
  const bpsSum = action.splitRecipients.reduce((sum, r) => sum + (Number.isFinite(Number(r.bps)) ? Number(r.bps) : 0), 0);
  const over = bpsSum > 10_000;

  function updateRow(id: string, patch: Partial<ComposerAction["splitRecipients"][number]>) {
    onChange({ splitRecipients: action.splitRecipients.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }

  function removeRow(id: string) {
    onChange({ splitRecipients: action.splitRecipients.filter((r) => r.id !== id) });
  }

  return (
    <div className="flex flex-col gap-3">
      <AmountField label="Total amount to distribute (USDC)" value={action.splitTotal} onChange={(e) => onChange({ splitTotal: e.target.value })} />

      <div className="flex flex-col gap-2">
        {action.splitRecipients.map((row) => (
          <div key={row.id} className="flex items-end gap-2">
            <div className="flex-1">
              <AddressField label="Recipient" value={row.address} onChange={(e) => updateRow(row.id, { address: e.target.value })} />
            </div>
            <div className="w-28">
              <Field
                label="Share (bps)"
                value={row.bps}
                onChange={(e) => updateRow(row.id, { bps: e.target.value })}
                placeholder="7000"
                inputMode="numeric"
              />
            </div>
            <RemoveButton onClick={() => removeRow(row.id)} label="Remove recipient" />
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ splitRecipients: [...action.splitRecipients, newSplitRecipientRow()] })}
          className="self-start rounded-lg border border-border px-3 py-1.5 text-xs text-ink-muted transition-colors duration-200 hover:border-ink-faint"
        >
          + Recipient
        </button>
      </div>

      <p className={`text-xs ${over ? "text-red-400" : "text-ink-faint"}`}>
        {bpsSum} / 10000 bps ({(bpsSum / 100).toFixed(2)}%) {over && "— exceeds 100%"}
      </p>
    </div>
  );
}
