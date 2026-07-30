import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

export type ToastKind = "pending" | "success" | "error" | "info";

export interface ToastAction {
  label: string;
  href: string;
}

export interface ToastInput {
  kind: ToastKind;
  /** Short headline. Wrap amounts/addresses in a mono span at the call site if you need selective mono styling. */
  title: ReactNode;
  detail?: ReactNode;
  action?: ToastAction;
  /** ms before auto-dismiss. Omit to use the kind's default (success/info ~5s, pending/error stay until dismissed or updated). */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: string;
}

interface ToastContextValue {
  /** Adds a toast, returns its id so a later call can update() it in place (e.g. pending -> success) instead of stacking a second toast for the same action. */
  push: (input: ToastInput) => string;
  update: (id: string, patch: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Reuse the SAME toast system already wired into every wagmi tx flow (Deposit/Withdraw, Deploy, Pause/Resume, Run now, Create account) — never call this outside a mounted ToastProvider (see main.tsx). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

let nextId = 0;
function freshId(): string {
  nextId += 1;
  return `toast-${nextId}`;
}

const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  pending: 0,
  success: 5000,
  info: 5000,
  error: 0,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = freshId();
    setToasts((prev) => [...prev, { ...input, id }]);
    return id;
  }, []);

  const update = useCallback((id: string, patch: Partial<ToastInput>) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const value = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end sm:p-6"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

const BORDER: Record<ToastKind, string> = {
  pending: "border-brand-bronze/25",
  success: "border-emerald-400/30",
  error: "border-red-400/30",
  info: "border-brand-violet/30",
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const duration = toast.durationMs ?? DEFAULT_DURATIONS[toast.kind];

  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
    // Re-arms whenever kind/duration changes (e.g. pending -> success switches
    // from "never" to "~5s") so the countdown starts fresh from the update,
    // not from when the toast first appeared as a different kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.kind, duration]);

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={`animate-toast-in pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border bg-brand-surface/95 p-3.5 shadow-lg shadow-black/30 backdrop-blur-sm ${BORDER[toast.kind]}`}
    >
      <span className="mt-0.5 shrink-0">
        <ToastIcon kind={toast.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-brand-ink">{toast.title}</p>
        {toast.detail && <p className="mt-0.5 text-xs leading-snug text-brand-muted">{toast.detail}</p>}
        {toast.action && (
          <a
            href={toast.action.href}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs text-brand-violet-soft underline underline-offset-2 hover:text-brand-ink"
          >
            {toast.action.label}
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-0.5 text-brand-muted/70 transition-colors duration-200 hover:text-brand-ink"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function ToastIcon({ kind }: { kind: ToastKind }) {
  switch (kind) {
    case "pending":
      return (
        <svg className="h-4 w-4 animate-spin text-brand-violet-soft" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "success":
      return (
        <svg
          className="h-4 w-4 text-emerald-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      );
    case "error":
      return (
        <svg
          className="h-4 w-4 text-red-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16h.01" />
        </svg>
      );
    case "info":
      return (
        <svg
          className="h-4 w-4 text-brand-violet-soft"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      );
  }
}
