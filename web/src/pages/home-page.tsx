import { useEffect, useState } from "react";

import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { RepositoryList } from "@/components/common/repository-list";
import { ErrorAlert } from "@/components/common/error-alert";
import { InlineLoadingState } from "@/components/ui/loading-state";

import { listPublicRepositories, formatApiError, type RepositoryRecord } from "@/lib/api";
export function HomePage() {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let canceled = false;
    listPublicRepositories()
      .then((data) => {
        if (!canceled) setRepositories(data);
      })
      .catch((cause) => {
        if (!canceled) setError(formatApiError(cause));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <>
      <PageHeader title="探索" />
      <Panel>
        <ErrorAlert inset error={error} />
        {loading ? (
          <InlineLoadingState />
        ) : (
          !error && <RepositoryList repositories={repositories} publicOnly />
        )}
      </Panel>
    </>
  );
}
