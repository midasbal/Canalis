/**
 * A barely-perceptible aged-paper grain over the whole landing page.
 * Entirely static (no animation, no JS): a small feTurbulence-generated
 * SVG tile, tinted warm bronze via feColorMatrix, encoded as a data URI
 * and repeated via a plain CSS `background-image` the browser rasterizes
 * once and reuses as a tile, exactly like any other repeating background
 * texture. There is nothing to recompute per frame, so this costs nothing
 * ongoing regardless of scroll or page length.
 *
 * `absolute inset-0` inside Landing's relative wrapper (same technique as
 * ChannelSpine) so it spans the full document height and scrolls with the
 * page, like a texture printed on the page itself rather than a
 * screen-space overlay. `-z-10` keeps it behind every real section
 * background. Non-interactive, decorative only.
 */

// Bronze (#C6A15B) as 0-1 RGB for the feColorMatrix tint: C6=0.776, A1=0.631, 5B=0.357.
const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>
  <filter id='n'>
    <feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch' />
    <feColorMatrix type='matrix' values='0 0 0 0 0.776  0 0 0 0 0.631  0 0 0 0 0.357  0 0 0 0.5 0' />
  </filter>
  <rect width='100%' height='100%' filter='url(#n)' />
</svg>`;

const GRAIN_DATA_URL = `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`;

export function GrainOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05]"
      style={{ backgroundImage: GRAIN_DATA_URL, backgroundRepeat: "repeat", backgroundSize: "200px 200px" }}
    />
  );
}
