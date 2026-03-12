import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription
} from "@/components/ui/card";
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
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
          <div className="space-y-4">
            <Badge variant="secondary" className="w-fit">
              Issue to Session to PR to Review
            </Badge>
            <div className="space-y-3">
              <h1 className="font-display text-section-heading-mobile text-text-primary md:text-section-heading">
                把仓库、任务、评审和 Agent 交付压进同一条主链路。
              </h1>
              <p className="max-w-3xl text-body-sm text-text-secondary md:text-body-md">
                gits 的前端现在围绕仓库入口、任务中心和交付回看统一组织。你可以从公开仓库开始浏览，
                再进入 Issue、PR、Actions 与 Session 细节。
              </p>
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
            <div className="page-panel-muted p-4">
              <p className="text-label-xs text-text-supporting">公开仓库</p>
              <p className="mt-3 font-display text-section-heading-mobile text-text-primary">
                {loading ? "..." : repositories.length}
              </p>
              <p className="mt-2 text-body-xs text-text-secondary">
                浏览当前公开的仓库入口和最近新增项目。
              </p>
            </div>
            <div className="page-panel p-4">
              <p className="text-label-xs text-text-supporting">协作模式</p>
              <p className="mt-3 font-display text-heading-3-16-semibold text-text-primary">
                Repository-first
              </p>
              <p className="mt-2 text-body-xs text-text-secondary">
                从仓库进入代码、Issue、PR、Actions，再回到 Session 追踪交付。
              </p>
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
          <div className="space-y-1">
            <h2 className="font-display text-heading-3-16-semibold text-text-primary">
              Explore public repositories
            </h2>
            <p className="text-body-sm text-text-secondary">
              公开仓库发现页保持轻量，但已经可以直接跳转到代码与交付上下文。
            </p>
          </div>
          <Badge variant="outline">{loading ? "Refreshing" : `${repositories.length} repositories`}</Badge>
        </div>

        {loading ? (
          <Card className="m-4 border-none bg-transparent shadow-none">
            <CardContent className="pt-2">
            <InlineLoadingState
              title="Loading repositories"
              description="Fetching the latest public repositories."
              lines={3}
            />
          </CardContent>
          </Card>
        ) : repositories.length === 0 ? (
          <div className="p-6 text-body-sm text-text-secondary">暂无公开仓库。</div>
        ) : (
          <div className="grid items-start gap-4 p-4 md:grid-cols-2">
            {repositories.map((repo) => (
              <Card key={repo.id} className="transition-transform duration-200 ease-out hover:-translate-y-1">
                <CardContent className="flex flex-col gap-5 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-2.5">
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

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4 text-body-micro text-text-secondary">
                    <span>Created on {formatDateTime(repo.created_at)}</span>
                    <Link
                      to={`/repo/${repo.owner_username}/${repo.name}`}
                      className="gh-link shrink-0 font-sans text-label-sm"
                    >
                      查看详情
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
