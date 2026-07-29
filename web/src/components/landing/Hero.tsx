import { useEffect, useRef } from "react";
import { Logo } from "../ui/Logo";
import { RotatingWord } from "./RotatingWord";
import { useReducedMotion } from "./useReducedMotion";

interface HeroProps {
  onEnter: () => void;
  entering: boolean;
}

// How much the hero image drifts per pixel scrolled, and the cap on that
// drift — deliberately tiny ("small translate, not dramatic") so it reads
// as depth, not a parallax showcase. Set via the `transform` property only
// (see the effect below) — HERO_ZOOM is applied separately via the
// standalone CSS `scale` property (Tailwind's `scale-*` utility compiles
// to `scale:`, not `transform: scale()`, in this Tailwind version), so the
// two compose independently instead of needing to be combined in one
// string; this also means the on-screen parallax movement is an exact
// `offset`px regardless of HERO_ZOOM (the individual `scale`/`translate`/
// `rotate` properties apply before `transform`, per the CSS Transforms
// Level 2 cascade, so `transform: translateY()` here runs in the
// already-scaled outer coordinate space).
const PARALLAX_FACTOR = 0.06;
const PARALLAX_MAX_PX = 46;

// Extra static zoom on top of object-fit:cover's own auto-scale. The
// source engraving (public/hero-aqueduct.jpg) has a thin aged-paper
// mount border along its right edge (measured: the engraving's own inner
// frame ends at x=1248 of 1280px, ~97.5% of the width) that object-position
// alone can't reliably hide at every viewport aspect ratio — a wide/
// ultrawide window can make object-fit:cover crop the image's width
// barely at all, showing nearly the full 1280px including that border.
// A fixed extra scale, independent of aspect ratio, guarantees the visible
// right edge stays at (transformOriginX + (1 - transformOriginX) / HERO_ZOOM)
// of the source width in the worst case (zero natural horizontal crop) —
// with these values that's ~94%, comfortably inside the 97.5% seam with a
// margin to spare; any narrower/taller viewport (which crops more of the
// width already) only pulls the visible edge further left, never right.
const HERO_ZOOM = 1.15;
const HERO_ZOOM_ORIGIN = "55% 50%";

/**
 * Full-viewport hero — the first thing a pre-connect visitor sees. The
 * aqueduct engraving (public/hero-aqueduct.jpg) is framed so the structure
 * fills the right/center of the frame while the left stays open for text;
 * a left-to-transparent scrim keeps the headline legible over whatever the
 * image is doing underneath, at any width. `HERO_ZOOM` keeps the
 * engraving's own paper-mount border out of frame on the right (see that
 * constant's docs) without needing separate scale values per breakpoint.
 *
 * "Living hero" touches (all gated behind useReducedMotion, all slow and
 * calm): a soft mist drifting low over the valley, a second glow blob
 * pulsing along the engraving's painted violet vein out of phase with the
 * first (suggesting the light traveling, not just breathing in place),
 * and a small scroll-tied parallax on the image itself.
 */
export function Hero({ onEnter, entering }: HeroProps) {
  const reducedMotion = useReducedMotion();
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (reducedMotion) return;
    let ticking = false;
    function update() {
      ticking = false;
      const offset = Math.min(PARALLAX_MAX_PX, window.scrollY * PARALLAX_FACTOR);
      // Only translateY here — HERO_ZOOM stays on the CSS `scale` property
      // (the `scale-[1.15]` class below), never duplicated into this
      // string. Setting `transform: translateY(...) scale(HERO_ZOOM)`
      // here would compound with that persistent `scale` property once
      // this ever ran (effective zoom 1.15 x 1.15), not replace it.
      if (imgRef.current) imgRef.current.style.transform = `translateY(${offset}px)`;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reducedMotion]);

  return (
    <section className="relative flex min-h-screen flex-col overflow-hidden bg-brand-base">
      {/* HERO_ZOOM is set via the standalone `scale` CSS property (inline
          style, so it's a single JS-driven source of truth) rather than a
          Tailwind `scale-[...]` class — that class compiles to this same
          `scale` property in this Tailwind version, and keeping it out of
          the `transform` property (which the parallax effect owns
          exclusively below) avoids the two ever compounding. */}
      <img
        ref={imgRef}
        src="/hero-aqueduct.jpg"
        alt=""
        aria-hidden="true"
        className="absolute inset-x-0 top-[-8%] h-[116%] w-full object-cover object-[78%_52%] will-change-transform sm:object-[82%_50%]"
        style={{ transformOrigin: HERO_ZOOM_ORIGIN, scale: String(HERO_ZOOM) }}
      />

      {/* Left-to-transparent scrim so the headline stays crisp regardless
          of what's behind it; a touch stronger on mobile since the text
          column has less room to dodge the artwork. */}
      <div className="absolute inset-0 bg-gradient-to-r from-brand-base via-brand-base/85 to-brand-base/10 sm:via-brand-base/75 sm:to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-base via-transparent to-transparent sm:hidden" />
      {/* Bottom vignette so the hero blends into the next section rather than cutting off hard. */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-brand-base to-transparent" />

      {!reducedMotion && (
        <>
          {/* Slow drifting mist low in the valley, warm-neutral so it reads as fog, not another violet accent. */}
          <div
            className="animate-mist-drift pointer-events-none absolute bottom-[8%] left-[15%] h-28 w-[55%] rounded-full opacity-20 blur-3xl"
            style={{ backgroundColor: "var(--color-brand-muted)" }}
            aria-hidden="true"
          />
          <div
            className="animate-mist-drift pointer-events-none absolute bottom-[4%] left-[40%] h-20 w-[40%] rounded-full opacity-15 blur-3xl"
            style={{ backgroundColor: "var(--color-brand-muted)", animationDelay: "-16s", animationDuration: "26s" }}
            aria-hidden="true"
          />
        </>
      )}

      {/* Two quiet glows along the engraving's own painted violet channel,
          pulsing out of phase (the second delayed by roughly half the
          cycle) so the light reads as gently traveling rather than just
          breathing in one spot. */}
      <div
        className="animate-glow-pulse pointer-events-none absolute top-[18%] right-[8%] h-40 w-72 rounded-full opacity-60 blur-3xl"
        style={{ backgroundColor: "var(--color-brand-violet-soft)" }}
        aria-hidden="true"
      />
      {!reducedMotion && (
        <div
          className="animate-glow-pulse pointer-events-none absolute top-[26%] right-[32%] h-28 w-48 rounded-full opacity-40 blur-3xl"
          style={{ backgroundColor: "var(--color-brand-violet-soft)", animationDelay: "-1.6s" }}
          aria-hidden="true"
        />
      )}

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 sm:px-8">
        <div className="flex items-center gap-2 pt-6 sm:pt-8">
          <Logo className="h-6 w-6 sm:h-7 sm:w-7" />
          <span className="text-base font-semibold tracking-tight text-brand-ink sm:text-lg">Canalis</span>
        </div>

        <div className="flex flex-1 flex-col justify-center py-16 sm:py-0">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-bronze/30 bg-brand-surface/60 px-3 py-1 font-mono text-[11px] tracking-wide text-brand-muted uppercase">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-violet" />
              Live on Arc testnet
            </span>

            <h1 className="mt-5 font-display text-4xl leading-[1.08] font-medium text-brand-ink sm:text-5xl lg:text-6xl">
              Money that runs <RotatingWord />
            </h1>

            <p className="mt-5 max-w-md text-base leading-relaxed text-brand-muted sm:text-lg">
              A visual, AI-assisted builder for programmable USDC money-flows on Arc. Compose a rule, deploy it to
              your own on-chain vault, and your money routes, swaps, and settles itself.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <button
                onClick={onEnter}
                disabled={entering}
                className="rounded-full border border-brand-violet/40 bg-brand-violet/15 px-6 py-3 text-sm font-medium text-brand-ink transition-all duration-300 hover:border-brand-violet/70 hover:bg-brand-violet/25 hover:shadow-[0_0_28px_-6px_var(--color-brand-violet)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {entering ? "Connecting…" : "Enter Canalis"}
              </button>
              <a
                href="#how-it-works"
                className="text-sm font-medium text-brand-muted underline decoration-brand-bronze/40 underline-offset-4 transition-colors duration-200 hover:text-brand-ink"
              >
                How it works
              </a>
              <a
                href="https://github.com/midasbal/Canalis"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-brand-muted underline decoration-brand-bronze/40 underline-offset-4 transition-colors duration-200 hover:text-brand-ink"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
