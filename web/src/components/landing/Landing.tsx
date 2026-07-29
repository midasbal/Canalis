import { Hero } from "./Hero";
import { WhatItIs } from "./WhatItIs";
import { UseCases } from "./UseCases";
import { Capabilities } from "./Capabilities";
import { WhyArc } from "./WhyArc";
import { LandingFooter } from "./LandingFooter";
import { ChannelSpine } from "./ChannelSpine";
import { Reveal } from "./Reveal";
import { GrainOverlay } from "./GrainOverlay";
import { AmbientMotes } from "./AmbientMotes";
import { ArchDivider } from "./ArchDivider";

interface LandingProps {
  /** Triggers the wallet connect flow (or, if already connected, just clears a forced-landing override). See App.tsx. */
  onEnter: () => void;
  /** True while a connect request is in flight, so the CTA can say "Connecting…" instead of sitting silent. */
  entering: boolean;
}

/**
 * The pre-connect landing page, shown whenever the wallet is disconnected
 * (see App.tsx's showLanding). Introduces the "brand-*" design tokens
 * (src/index.css) that a later polish pass will propagate to the
 * connected app (Header/Builder/Dashboard), which still use the original
 * tokens today and are untouched by this page.
 *
 * Background layers, back to front: `GrainOverlay` (static aged-paper
 * texture) and `AmbientMotes` (a few slow drifting particles), both
 * `absolute inset-0` inside this `relative` wrapper so they span the full
 * document height, then `ChannelSpine` (the scroll-tracked vertical
 * conduit) on top of those, then the real content. Each section is
 * wrapped in `Reveal` (fade + rise + blur-to-sharp + a drawn-in hairline,
 * triggered when the spine's flow reaches that section) with `branch` set
 * so the spine draws a small tick where that section begins. `ArchDivider`
 * marks a few section breaks with a quiet row of arches; not placed at
 * every single seam (e.g. skipped right around Capabilities' own
 * border-y) to keep the repetition from reading as busy.
 */
export function Landing({ onEnter, entering }: LandingProps) {
  return (
    <div className="relative bg-brand-base font-sans text-brand-ink">
      <GrainOverlay />
      <AmbientMotes />
      <ChannelSpine />
      <Hero onEnter={onEnter} entering={entering} />
      <Reveal branch>
        <WhatItIs />
      </Reveal>
      <ArchDivider />
      <Reveal branch>
        <UseCases />
      </Reveal>
      <Reveal branch>
        <Capabilities />
      </Reveal>
      <Reveal branch>
        <WhyArc />
      </Reveal>
      <ArchDivider />
      <LandingFooter onEnter={onEnter} entering={entering} />
    </div>
  );
}
