import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatApiError, getRepositoryDetail, type RepositoryDetailResponse } from "@/lib/api";
export function useRepository() {
  const { owner = "", repo = "" } = useParams();
  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let canceled = false;
    getRepositoryDetail(owner, repo)
      .then((data) => {
        if (!canceled) setDetail(data);
      })
      .catch((cause) => {
        if (!canceled) setError(formatApiError(cause));
      });
    return () => {
      canceled = true;
    };
  }, [owner, repo]);
  return { owner, repo, detail, setDetail, error, setError };
}
