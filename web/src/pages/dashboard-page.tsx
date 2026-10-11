import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { RepositoryList } from "@/components/common/repository-list";
import { ErrorAlert } from "@/components/common/error-alert";
import { TableSkeleton } from "@/components/common/list-skeletons";
import { Button } from "@/components/ui/button";
import {
  listMyRepositories,
  formatApiError,
  type RepositoryRecord,
  type AuthUser
} from "@/lib/api";
export function MyRepositoriesPage({ user }: { user: AuthUser | null }) {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let canceled = false;
    listMyRepositories()
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
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      <PageHeader
        title="我的仓库"
        action={
          <Button asChild>
            <Link to="/repositories/new">新建仓库</Link>
          </Button>
        }
      />
      <Panel>
        <ErrorAlert inset error={error} />
        {loading ? (
          <TableSkeleton variant="repositories" />
        ) : (
          !error && <RepositoryList repositories={repositories} />
        )}
      </Panel>
    </>
  );
}
