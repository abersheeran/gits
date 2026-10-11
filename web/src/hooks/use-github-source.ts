import { useCallback, useEffect, useRef, useState } from "react";
import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import { useGithubPolling } from "./use-github-polling";
import {
  getGithubSource,
  listGithubRepositories,
  type GithubRepositoryFilter,
  type GithubRepositoryPage,
  type GithubSource
} from "@/lib/github-api";

export function useGithubSource(id: string, status: GithubRepositoryFilter, page: number) {
  const key = `${id}/${status}/${page}`;
  const [data, setData] = useState<{
    key: string;
    source: GithubSource;
    repositories: GithubRepositoryPage;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const sequence = useRef({ value: 0 });
  const refresh = useCallback(() => {
    const request = ++sequence.current.value;
    return Promise.all([getGithubSource(id), listGithubRepositories(id, status, page)]).then(
      ([{ source }, repositories]) => {
        if (request === sequence.current.value) {
          setData({ key, source, repositories });
          setFailure(null);
        }
      },
      (cause) => {
        if (request === sequence.current.value) setFailure({ key, message: formatApiError(cause) });
      }
    );
  }, [id, key, page, status]);
  useEffect(() => {
    const counter = sequence.current;
    void refresh();
    return () => {
      counter.value++;
    };
  }, [refresh]);
  const current = data?.key === key ? data : null;
  useGithubPolling(Boolean(current), refresh);
  return {
    source: data?.source.id === id ? data.source : null,
    repositories: current?.repositories ?? null,
    error: failure?.key === key ? failure.message : null,
    refresh
  };
}
