import { useEffect, useState } from "react";
import {
  getRepositoryCommitDetail,
  formatApiError,
  type RepositoryCommitDetailResponse
} from "@/lib/api";
export function useCommitDetail(owner: string, repo: string, oid: string | null) {
  const [detail, setDetail] = useState<RepositoryCommitDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let canceled = false;
    async function load() {
      setDetail(null);
      setError(null);
      if (!oid) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await getRepositoryCommitDetail(owner, repo, oid);
        if (!canceled) setDetail(result);
      } catch (cause) {
        if (!canceled) setError(formatApiError(cause));
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [owner, repo, oid]);
  return { detail, loading, error };
}
