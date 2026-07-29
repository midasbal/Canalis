import { useEffect, useState } from "react";

/**
 * Tracks `prefers-reduced-motion: reduce`, live (reacts if the user flips
 * the OS setting mid-session, not just at mount). Shared by every landing
 * component that needs to swap a live animation for a static equivalent
 * rather than relying solely on the global CSS override in index.css
 * (which just crushes animation-duration to ~0, an arbitrary freeze frame,
 * not necessarily the deliberate "final state" a component wants to show).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
