/** Minimal line icons for the landing's capability cards — kept separate from components/ui/icons.tsx so the landing's icon set can evolve independently of the connected app's. */

const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function KeeperIcon() {
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v4.7l3.2 1.9" />
    </svg>
  );
}

export function OracleIcon() {
  return (
    <svg {...common}>
      <path d="M4 17l4.5-6 4 4L18 6" />
      <path d="M14 6h4v4" />
    </svg>
  );
}

export function BridgeIcon() {
  return (
    <svg {...common}>
      <path d="M3 16c2-4 5-6 9-6s7 2 9 6" />
      <path d="M6 16v3M18 16v3M3 19h18" />
    </svg>
  );
}

export function LanguageIcon() {
  return (
    <svg {...common}>
      <path d="M4 5h9M4 9h6" />
      <path d="M8.5 5c0 5-2 8-5 9.5" />
      <path d="M6 12c1.4 1.6 3.2 2.4 5 2.6" />
      <path d="M13 19l3.5-9 3.5 9M14.4 16h4.2" />
    </svg>
  );
}

export function VaultIcon() {
  return (
    <svg {...common}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9.5v-1M12 15.5v-1M9.5 12h-1M15.5 12h-1" />
    </svg>
  );
}

export function TestedIcon() {
  return (
    <svg {...common}>
      <path d="M9 3h6M10 3v4.2L5.5 15a3 3 0 0 0 2.6 4.5h7.8a3 3 0 0 0 2.6-4.5L14 7.2V3" />
      <path d="M8 15h8" />
    </svg>
  );
}
