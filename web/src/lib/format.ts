import { formatUnits } from "viem";
import type { Address } from "viem";

/** Arc testnet USDC's ERC-20 decimals — do not confuse with the 18-decimal native gas token. */
export const USDC_DECIMALS = 6;

const ARCSCAN_BASE = "https://testnet.arcscan.app";

export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

export function shortAddress(address: Address | string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function arcscanAddressUrl(address: string): string {
  return `${ARCSCAN_BASE}/address/${address}`;
}

export function arcscanTxUrl(hash: string): string {
  return `${ARCSCAN_BASE}/tx/${hash}`;
}

/**
 * JS `Date` only represents ±100,000,000 days from the epoch
 * (~273,790 years) — anything past that (e.g. Solidity's
 * `type(uint256).max` sentinel, ~3.7e68 years out) must be treated as
 * "not a real date", not fed to `new Date()` (which silently produces
 * "Invalid Date"). See lib/flows.ts's `SCHEDULE_NEVER_AGAIN` for the
 * specific sentinel this guards against.
 */
const MAX_DATE_SECONDS = 8_640_000_000_000_000 / 1000;

/** unix seconds -> a readable local date/time, or an honest "—" for unset (0) or out-of-range values. */
export function formatTimestamp(unixSeconds: bigint | number): string {
  const seconds = Number(unixSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_DATE_SECONDS) return "—";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

/** A short "1d 2h" / "45s" style duration, or "0s" for zero. */
export function formatDuration(seconds: bigint | number): string {
  let s = Math.max(0, Math.floor(Number(seconds)));
  if (!Number.isFinite(s)) return "—";
  if (s === 0) return "0s";

  const units: [string, number][] = [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ];
  const parts: string[] = [];
  for (const [label, size] of units) {
    if (s >= size) {
      const count = Math.floor(s / size);
      s -= count * size;
      parts.push(`${count}${label}`);
      if (parts.length === 2) break;
    }
  }
  return parts.join(" ");
}

/** Countdown to a future unix-seconds timestamp, or "due now" once reached/passed. "—" for unset (0) or an out-of-range sentinel (see formatTimestamp). */
export function formatCountdown(targetUnixSeconds: bigint, nowUnixSeconds: number): string {
  const target = Number(targetUnixSeconds);
  if (!Number.isFinite(target) || target === 0 || target > MAX_DATE_SECONDS) return "—";
  const delta = target - nowUnixSeconds;
  if (delta <= 0) return "due now";
  return `in ${formatDuration(delta)}`;
}

/** `2026-07-27T14:30` datetime-local input value -> unix seconds, or null if unset/invalid. */
export function datetimeLocalToUnixSeconds(value: string): bigint | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return BigInt(Math.floor(ms / 1000));
}

/** unix seconds -> a `datetime-local` input value, or "" for unset (0). */
export function unixSecondsToDatetimeLocal(unixSeconds: bigint): string {
  const seconds = Number(unixSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
