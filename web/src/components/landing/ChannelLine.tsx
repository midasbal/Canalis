/**
 * The recurring "channel" motif: a thin bronze hairline with a soft violet
 * segment traveling along it — Canalis (Latin: channel/conduit) as a value
 * literally flowing through a line. Used as section dividers and as the
 * connector between nodes in FlowDiagram. A single reusable primitive so
 * every appearance of the motif stays visually identical.
 */
interface ChannelLineProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function ChannelLine({ orientation = "horizontal", className = "" }: ChannelLineProps) {
  const horizontal = orientation === "horizontal";
  const viewBox = horizontal ? "0 0 200 2" : "0 0 2 200";

  return (
    <svg
      viewBox={viewBox}
      width={horizontal ? "100%" : "2"}
      height={horizontal ? "2" : "100%"}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <line
        x1={horizontal ? "0" : "1"}
        y1={horizontal ? "1" : "0"}
        x2={horizontal ? "200" : "1"}
        y2={horizontal ? "1" : "200"}
        stroke="var(--color-brand-bronze)"
        strokeOpacity="0.3"
        strokeWidth="1"
      />
      <line
        x1={horizontal ? "0" : "1"}
        y1={horizontal ? "1" : "0"}
        x2={horizontal ? "200" : "1"}
        y2={horizontal ? "1" : "200"}
        stroke="var(--color-brand-violet-soft)"
        strokeWidth="1.5"
        strokeDasharray="24 40"
        strokeLinecap="round"
        className="animate-channel-flow"
      />
    </svg>
  );
}
