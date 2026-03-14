import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HelpTip } from "@/components/common/help-tip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardDescription } from "@/components/ui/card";
import { InlineLoadingState } from "@/components/ui/loading-state";
import { formatApiError, listPublicRepositories, type AuthUser, type RepositoryRecord } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type HomePageProps = {
  user: AuthUser | null;
};

export function HomePage({ user }: HomePageProps) {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const rows = await listPublicRepositories(50);
        if (!canceled) {
          setRepositories(rows);
        }
      } catch (loadError) {
        if (!canceled) {
          setError(formatApiError(loadError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div className="app-page">
      <section className="page-hero">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2">
              <Badge variant="secondary" className="w-fit">
                Explore
              </Badge>
              <HelpTip content="游客可以直接浏览公开仓库，并从仓库页进入代码、Issue、PR 与 Actions 上下文。" />
            </div>
            <div className="space-y-3">
              <h1 className="font-display text-section-heading-mobile text-text-primary md:text-section-heading">
                公开仓库发现
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-body-sm text-text-secondary md:text-body-md">
                <span>{loading ? "同步中..." : `${repositories.length} 个公开仓库`}</span>
                {repositories[0] ? (
                  <Link
                    to={`/repo/${repositories[0].owner_username}/${repositories[0].name}`}
                    className="gh-link"
                  >
                    最新：{repositories[0].owner_username}/{repositories[0].name}
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {user ? (
                <>
                  <Button asChild>
                    <Link to="/dashboard">进入 Dashboard</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/repositories/new">创建仓库</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild>
                    <Link to="/register">创建账号</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/login">登录已有账号</Link>
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="page-panel-muted panel-content">
              <p className="text-label-xs text-text-supporting">Public repositories</p>
              <p className="mt-3 font-display text-section-heading-mobile text-text-primary">
                {loading ? "..." : repositories.length}
              </p>
            </div>
            <div className="panel-card">
              <p className="text-label-xs text-text-supporting">Latest entry</p>
              {repositories[0] ? (
                <Link
                  to={`/repo/${repositories[0].owner_username}/${repositories[0].name}`}
                  className="mt-3 block font-display text-heading-3-16-semibold text-text-primary transition-colors duration-100 ease-in-out hover:text-text-supportingStrong"
                >
                  {repositories[0].owner_username}/{repositories[0].name}
                </Link>
              ) : (
                <p className="mt-3 font-display text-heading-3-16-semibold text-text-primary">
                  Waiting for repos
                </p>
              )}
              {repositories[0]?.description?.trim() ? (
                <p className="mt-2 text-body-xs text-text-secondary">{repositories[0].description}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="page-panel overflow-hidden">
        <div className="panel-toolbar">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-heading-3-16-semibold text-text-primary">
              Explore public repositories
            </h2>
            <HelpTip content="列表展示最近可访问的公开仓库，直接跳转到仓库详情页。" />
          </div>
          <Badge variant="outline">{loading ? "Refreshing" : `${repositories.length} repositories`}</Badge>
        </div>

        {loading ? (
          <div className="panel-content">
            <InlineLoadingState
              title="Loading repositories"
              description="Fetching the latest public repositories."
              lines={3}
            />
          </div>
        ) : repositories.length === 0 ? (
          <div className="p-4 text-body-sm text-text-secondary">暂无公开仓库。</div>
        ) : (
          <div className="grid items-start gap-4 p-4 md:grid-cols-2">
            {repositories.map((repo) => (
              <div
                key={repo.id}
                className="overflow-hidden rounded-[16px] bg-surface-base transition-transform duration-200 ease-out hover:-translate-y-0.5"
              >
                <div className="flex h-full flex-col">
                  <div className="flex flex-1 flex-col gap-4 p-4 md:p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-2">
                        <Link
                          to={`/repo/${repo.owner_username}/${repo.name}`}
                          className="gh-link block font-display text-heading-3-16-semibold"
                        >
                          {repo.owner_username}/{repo.name}
                        </Link>
                        <CardDescription className="pr-2">
                          {repo.description?.trim() ? repo.description : "No description provided."}
                        </CardDescription>
                      </div>
                      <Badge
                        variant={repo.is_private === 1 ? "destructive" : "outline"}
                        className="shrink-0 self-start"
                      >
                        {repo.is_private === 1 ? "Private" : "Public"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-4 text-body-micro text-text-secondary md:px-4 md:py-4">
                    <span>Created on {formatDateTime(repo.created_at)}</span>
                    <Link
                      to={`/repo/${repo.owner_username}/${repo.name}`}
                      className="gh-link shrink-0 font-sans text-label-sm"
                    >
                      查看详情
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
