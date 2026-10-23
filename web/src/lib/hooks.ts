"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chainNow } from "./relay";

/** Loads data, reloads on an interval while the tab is visible, and on demand. */
export function usePoll<T>(load: () => Promise<T>, everyMs = 12_000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const refresh = useCallback(async () => {
    try {
      const next = await loadRef.current();
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, everyMs, ...deps]);

  return { data, error, refresh };
}

/**
 * Seconds on the chain's clock, ticking every second. Phases follow block
 * timestamps, which can drift from the wall clock (and jump on a local chain).
 */
export function useChainClock(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let offset: number | null = null;
    const sync = () =>
      chainNow()
        .then((t) => {
          offset = t - Date.now() / 1000;
          setNow(Date.now() / 1000 + offset);
        })
        .catch(() => {});
    sync();
    const s = setInterval(sync, 30_000);
    const t = setInterval(() => {
      if (offset !== null) setNow(Date.now() / 1000 + offset);
    }, 1000);
    return () => {
      clearInterval(s);
      clearInterval(t);
    };
  }, []);
  return now;
}
