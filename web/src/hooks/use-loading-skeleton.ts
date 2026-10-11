import { useEffect, useState } from "react";

export function useLoadingSkeleton(loading: boolean, hasContent: boolean, delay = 200) {
  const [elapsed, setElapsed] = useState(false);
  // Reset between requests before the next loading render can reuse the timer result.
  if (!loading && elapsed) setElapsed(false);

  useEffect(() => {
    if (!loading || !hasContent) return;
    const timer = window.setTimeout(() => setElapsed(true), delay);
    return () => window.clearTimeout(timer);
  }, [loading, hasContent, delay]);

  return loading && (!hasContent || elapsed);
}
