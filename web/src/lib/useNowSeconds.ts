import { useEffect, useState } from "react";

/** Ticking "now" in unix seconds — powers live countdowns (next-run, etc). */
export function useNowSeconds(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
