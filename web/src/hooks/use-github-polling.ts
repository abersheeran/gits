import { useEffect } from "react";

export function useGithubPolling(enabled: boolean, refresh: () => Promise<unknown>) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    async function tick() {
      if (stopped || document.hidden) return;
      await refresh();
      if (!stopped && !document.hidden) timer = setTimeout(tick, 10000);
    }
    function visibility() {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(tick, 10000);
    }
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, refresh]);
}
