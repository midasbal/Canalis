import { useReadContract } from "wagmi";
import { CONDITION_KIND_LABELS, emptyCondition, newAddressRow, type ComposerCondition, type ConditionKind } from "../../lib/composer";
import { ORACLE_FEEDS } from "../../lib/oracleFeeds";
import { pythAbi } from "../../lib/abi";
import { CANALIS_ORACLE_ADDRESS } from "../../lib/contracts";
import { AddressField, AmountField, Field, RemoveButton } from "./inputs";

const CONDITION_KINDS: ConditionKind[] = [
  "amountCap",
  "minBalance",
  "cooldown",
  "timeWindow",
  "allowList",
  "denyList",
  "oraclePrice",
];

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
        <p className="text-xs text-ink-faint">No conditions. The flow runs whenever its trigger fires, unguarded.</p>
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

      {condition.kind === "oraclePrice" && <OraclePriceEditor condition={condition} onChange={onChange} />}
    </div>
  );
}

/**
 * Arc-native feature slice (spec section 7.3 #2): reads a REAL live Pyth
 * price via `getPriceUnsafe` — same non-mocked source CanalisExecutor
 * itself checks on-chain — so the composer can show "current oracle price"
 * next to the threshold the flow author is setting, honestly reflecting
 * what the condition will actually evaluate against.
 */
function OraclePriceEditor({
  condition,
  onChange,
}: {
  condition: ComposerCondition;
  onChange: (patch: Partial<ComposerCondition>) => void;
}) {
  const feed = ORACLE_FEEDS.find((f) => f.key === condition.oracleFeedKey) ?? ORACLE_FEEDS[0];

  const priceQuery = useReadContract({
    address: CANALIS_ORACLE_ADDRESS,
    abi: pythAbi,
    functionName: "getPriceUnsafe",
    args: [feed.priceId],
    query: { enabled: Boolean(CANALIS_ORACLE_ADDRESS), refetchInterval: 15_000 },
  });

  const livePrice = priceQuery.data;
  const liveUsd = livePrice ? Number(livePrice.price) * 10 ** livePrice.expo : undefined;
  const lastUpdated = livePrice ? new Date(Number(livePrice.publishTime) * 1000) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Feed</span>
          <select
            value={condition.oracleFeedKey}
            onChange={(e) => onChange({ oracleFeedKey: e.target.value })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          >
            {ORACLE_FEEDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Condition</span>
          <select
            value={condition.oracleDirection}
            onChange={(e) => onChange({ oracleDirection: e.target.value as "above" | "below" })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="below">is below</option>
            <option value="above">is at or above</option>
          </select>
        </label>
        <Field
          label="Threshold (USD)"
          value={condition.oracleThreshold}
          onChange={(e) => onChange({ oracleThreshold: e.target.value })}
          placeholder="1.08"
          inputMode="decimal"
        />
      </div>

      <Field
        label="Max price staleness (seconds)"
        value={condition.oracleMaxStalenessSeconds}
        onChange={(e) => onChange({ oracleMaxStalenessSeconds: e.target.value })}
        placeholder="300"
        inputMode="numeric"
      />

      <p className="max-w-prose text-xs text-ink-faint">
        {!CANALIS_ORACLE_ADDRESS
          ? "Oracle not configured (VITE_ORACLE_ADDRESS)."
          : priceQuery.isLoading
            ? "Reading live oracle price…"
            : liveUsd !== undefined
              ? `Current ${feed.label} oracle price: $${liveUsd.toFixed(5)} (last updated ${lastUpdated?.toLocaleTimeString()}). The keeper refreshes this on-chain before evaluating flows with an oracle condition, see keeper/README.md.`
              : "No price stored on-chain yet for this feed. The keeper updates it before evaluating flows that need it."}
      </p>
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
