import { FlowComposer } from "./composer/FlowComposer";

/**
 * Builder tab: the real vertical-stepper flow composer (slice 5) — pick a
 * trigger, add conditions, add actions, preview the plain-English summary,
 * deploy. Optional templates pre-fill a starting draft. See
 * components/composer/ for the stepper sections and lib/composer.ts for
 * the draft model + validation.
 */
export function BuilderCanvas() {
  return <FlowComposer />;
}
