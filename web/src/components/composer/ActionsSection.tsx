import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { ActionType } from "../../lib/flows";
import {
  ACTION_KIND_LABELS,
  emptyAction,
  newSplitRecipientRow,
  swapTokenAddresses,
  type ComposerAction,
  type SwapTokenSymbol,
} from "../../lib/composer";
import { canalisSwapPoolAbi } from "../../lib/abi";
import { CANALIS_SWAP_POOL_ADDRESS } from "../../lib/contracts";
import { USDC_DECIMALS } from "../../lib/format";
import { BRIDGE_DESTINATIONS } from "../../lib/bridgeDestinations";
import { AddressField, AmountField, Field, RemoveButton } from "./inputs";

export const ACTION_KINDS: ActionType[] = [
  ActionType.Forward,
  ActionType.Split,
  ActionType.Sweep,
  ActionType.LockRelease,
  ActionType.Swap,
  ActionType.Bridge,
];

const PERCENT_INPUT_PATTERN = /^\d*\.?\d{0,2}$/;

/**
 * UI-only bps <-> percent conversion for Split shares and Swap slippage.
 * The underlying ComposerAction field (splitRecipients[].bps,
 * swapSlippageBps) stays basis points, unchanged, everywhere else, since
 * that's what composer.ts/draftToFlow and the contract actually use. Only
 * the input display and the node/chip summaries show percent, converting
 * at this boundary (percent x 100 = bps, rounded to stay a whole bps
 * integer). Up to 2 decimal places, so bps-level precision (e.g. 33.33%)
 * is still reachable.
 */
export function bpsStringToPercentText(bpsValue: string): string {
  if (!bpsValue.trim()) return "";
  const n = Number(bpsValue);
  if (!Number.isFinite(n)) return "";
  const pct = Math.round(n) / 100;
  return String(Math.round(pct * 100) / 100);
}

function percentTextToBpsString(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed === ".") return "";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100));
}

/** A bps-backed field that reads and is typed as a percentage (e.g. "70", "33.33"). Keeps its own text buffer so a trailing decimal point isn't stripped mid-typing. */
function PercentField({
  label,
  bps,
  onBpsChange,
  placeholder,
}: {
  label: string;
  bps: string;
  onBpsChange: (bps: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => bpsStringToPercentText(bps));

  return (
    <Field
      label={label}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        if (!PERCENT_INPUT_PATTERN.test(raw)) return;
        setText(raw);
        onBpsChange(percentTextToBpsString(raw));
      }}
      placeholder={placeholder}
      inputMode="decimal"
    />
  );
}

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
        <p className="text-xs text-ink-faint">Add at least one action. A flow that does nothing can't be deployed.</p>
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

export function ActionCard({
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
            label="Leave behind (USDC), sweeps everything above this"
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

      {action.kind === ActionType.Swap && <SwapEditor action={action} onChange={onChange} />}

      {action.kind === ActionType.Bridge && <BridgeEditor action={action} onChange={onChange} />}
    </div>
  );
}

/**
 * Bridge via Circle's real CCTP V2 (Arc-native feature slice, spec section
 * 7.3 #3 — see CanalisExecutor.sol's "ARC-NATIVE FEATURE: CCTP Bridge"
 * docs). Burns USDC on Arc; the mint on the destination chain is a
 * SEPARATE, asynchronous transaction (Circle's attestation service has to
 * sign the burn message first) — this composer only ever builds the burn
 * leg, honestly, with no promise of when or whether the mint follows.
 */
function BridgeEditor({ action, onChange }: { action: ComposerAction; onChange: (patch: Partial<ComposerAction>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Destination chain</span>
          <select
            value={action.bridgeDestinationKey}
            onChange={(e) => onChange({ bridgeDestinationKey: e.target.value })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          >
            {BRIDGE_DESTINATIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <AmountField label="Amount to bridge (USDC)" value={action.bridgeAmount} onChange={(e) => onChange({ bridgeAmount: e.target.value })} />
      </div>

      <AddressField
        label="Recipient on the destination chain"
        value={action.bridgeRecipient}
        onChange={(e) => onChange({ bridgeRecipient: e.target.value })}
      />

      <p className="max-w-prose text-xs text-ink-faint">
        Burns USDC on Arc via Circle's real CCTP V2. The mint on the destination chain completes separately, once Circle's
        attestation service signs the burn. That isn't part of this transaction and can take a few minutes.
      </p>
    </div>
  );
}

/**
 * Swap via CanalisSwapPool (our own USDC/EURC AMM — see
 * CanalisExecutor.sol's Arc-native-feature docs). Reads a live `quote()`
 * from the pool as the amount/direction change and auto-derives
 * `swapMinAmountOut` from that quote + the slippage tolerance — the
 * composer never lets a Swap deploy with an unset (zero) minAmountOut,
 * since that's real, functioning slippage protection thrown away, not a
 * sane default.
 */
function SwapEditor({ action, onChange }: { action: ComposerAction; onChange: (patch: Partial<ComposerAction>) => void }) {
  const [tokenIn] = swapTokenAddresses(action.swapTokenIn);
  const tokenOutSymbol: SwapTokenSymbol = action.swapTokenIn === "USDC" ? "EURC" : "USDC";

  let parsedAmountIn: bigint | undefined;
  try {
    parsedAmountIn = action.swapAmountIn.trim() ? parseUnits(action.swapAmountIn.trim(), USDC_DECIMALS) : undefined;
  } catch {
    parsedAmountIn = undefined;
  }

  const quoteQuery = useReadContract({
    address: CANALIS_SWAP_POOL_ADDRESS,
    abi: canalisSwapPoolAbi,
    functionName: "quote",
    args: tokenIn && parsedAmountIn ? [tokenIn, parsedAmountIn] : undefined,
    // Reserves can change underneath a mounted composer (e.g. the pool
    // gets re-seeded, or another swap runs) — poll like the oracle price
    // display does, so a stale quote never sits there looking current.
    query: {
      enabled: Boolean(CANALIS_SWAP_POOL_ADDRESS && tokenIn && parsedAmountIn && parsedAmountIn > 0n),
      refetchInterval: 15_000,
    },
  });

  const quote = quoteQuery.data;
  const slippageBps = Number(action.swapSlippageBps || "0");

  useEffect(() => {
    if (quote === undefined || !Number.isFinite(slippageBps)) return;
    const minOut = (quote * BigInt(Math.max(0, 10_000 - slippageBps))) / 10_000n;
    onChange({ swapMinAmountOut: formatUnits(minOut, USDC_DECIMALS) });
    // Only re-derive when the live quote or the slippage tolerance itself
    // changes — `onChange` is a fresh closure every render and isn't part
    // of what should re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, slippageBps]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Direction</span>
          <select
            value={action.swapTokenIn}
            onChange={(e) => onChange({ swapTokenIn: e.target.value as SwapTokenSymbol })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="USDC">USDC to EURC</option>
            <option value="EURC">EURC to USDC</option>
          </select>
        </label>
        <AmountField
          label={`Amount to swap (${action.swapTokenIn})`}
          value={action.swapAmountIn}
          onChange={(e) => onChange({ swapAmountIn: e.target.value })}
        />
      </div>

      <AddressField
        label="Recipient (receives the swapped-out token)"
        value={action.swapRecipient}
        onChange={(e) => onChange({ swapRecipient: e.target.value })}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PercentField
          label="Slippage tolerance (%)"
          bps={action.swapSlippageBps}
          onBpsChange={(swapSlippageBps) => onChange({ swapSlippageBps })}
          placeholder="1"
        />
        <AmountField
          label={`Minimum received (${tokenOutSymbol}), sent on-chain`}
          value={action.swapMinAmountOut}
          onChange={(e) => onChange({ swapMinAmountOut: e.target.value })}
        />
      </div>

      <p className="max-w-prose text-xs text-ink-faint">
        {!CANALIS_SWAP_POOL_ADDRESS
          ? "Pool not configured (VITE_CANALIS_SWAP_POOL_ADDRESS). Enter a minimum received manually."
          : quoteQuery.isLoading
            ? "Fetching live pool quote…"
            : quote !== undefined
              ? `Live quote: ${formatUnits(quote, USDC_DECIMALS)} ${tokenOutSymbol} right now. Minimum received above is auto-computed from this and your slippage tolerance (you can still edit it directly).`
              : "Enter an amount to see a live pool quote."}
      </p>
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
            <div className="w-24">
              <PercentField label="Share (%)" bps={row.bps} onBpsChange={(bps) => updateRow(row.id, { bps })} placeholder="70" />
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
        {bpsStringToPercentText(String(bpsSum))}% of 100% {over && "(exceeds 100%)"}
      </p>
    </div>
  );
}
