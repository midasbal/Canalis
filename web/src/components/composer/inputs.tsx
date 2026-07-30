import type { InputHTMLAttributes } from "react";

const inputClass =
  "w-full rounded-lg border border-brand-bronze/20 bg-brand-surface px-3 py-2 text-sm text-brand-ink placeholder:text-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-violet/50 focus:border-brand-violet/40";
const monoInputClass = `${inputClass} font-mono`;

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  mono?: boolean;
}

/** Labeled text input — the composer's base building block, styled with the existing tokens. */
export function Field({ label, mono, className, ...inputProps }: FieldProps) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-brand-muted">{label}</span>
      <input className={`${mono ? monoInputClass : inputClass} ${className ?? ""}`} {...inputProps} />
    </label>
  );
}

/** Address input — always mono, always `0x…` placeholder. */
export function AddressField(props: Omit<FieldProps, "mono" | "placeholder">) {
  return <Field mono placeholder="0x…" {...props} />;
}

/** USDC amount input — decimal keypad, `0.00` placeholder. */
export function AmountField(props: Omit<FieldProps, "placeholder" | "inputMode">) {
  return <Field placeholder="0.00" inputMode="decimal" {...props} />;
}

/** Small icon-only remove button, used across condition/action/recipient rows. */
export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-lg border border-brand-bronze/20 px-2 py-1 text-xs text-brand-muted/70 transition-colors duration-200 hover:border-red-400/40 hover:text-red-400"
    >
      Remove
    </button>
  );
}
