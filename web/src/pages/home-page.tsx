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
    <div className="space-y-6">
      <section className="rounded-2xl border bg-gradient-to-br from-slate-100 via-blue-50 to-white p-6">
        <h1 className="text-3xl font-semibold tracking-tight">Git Service Console</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          React 前端已接管界面层，后端继续由 Hono + D1 + R2 处理 API 与 Git 协议。你可以直接浏览仓库并跳转到详情页。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {user ? (
            <Button asChild>
              <Link to="/dashboard">进入 Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link to="/register">注册</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/login">登录</Link>
              </Button>
            </>
          )}
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">正在加载仓库列表...</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {repositories.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">暂无公开仓库。</CardContent>
            </Card>
          ) : (
            repositories.map((repo) => (
              <Card key={repo.id} className="rounded-xl border-border/80 shadow-none">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to={`/repo/${repo.owner_username}/${repo.name}`}
                      className="text-sm font-semibold text-[#0969da] hover:underline"
                    >
                      {repo.owner_username}/{repo.name}
                    </Link>
                    <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px] font-medium">
                      {repo.is_private === 1 ? "Private" : "Public"}
                    </Badge>
                  </div>

                  <CardDescription className="text-sm">
                    {repo.description?.trim() ? repo.description : "No description provided."}
                  </CardDescription>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Created on {formatDateTime(repo.created_at)}</span>
                    <Link
                      to={`/repo/${repo.owner_username}/${repo.name}`}
                      className="font-medium text-[#0969da] hover:underline"
                    >
                      查看详情
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
