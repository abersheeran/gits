import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineLoadingState } from "@/components/ui/loading-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatApiError, listMyRepositories, type AuthUser, type RepositoryRecord } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type DashboardPageProps = {
  user: AuthUser | null;
};

export function DashboardPage({ user }: DashboardPageProps) {
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadRepositories() {
    setLoading(true);
    setError(null);
    try {
      setRepositories(await listMyRepositories());
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRepositories();
  }, []);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-page">
      <section className="page-hero">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Badge variant="secondary" className="w-fit">
              Personal workspace
            </Badge>
            <div className="space-y-3">
              <h1 className="font-display text-section-heading-mobile text-text-primary md:text-section-heading">
                {user.username} 的交付工作面
              </h1>
              <p className="max-w-3xl text-body-sm text-text-secondary md:text-body-md">
                Dashboard 聚合了你拥有和参与的仓库，也保留了到 Tokens、Actions 配置和新仓库创建的直接入口。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/repositories/new">新建仓库</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/tokens">管理 Tokens</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Card className="bg-surface-focus shadow-none">
              <CardHeader>
                <CardDescription>Repositories</CardDescription>
                <CardTitle className="text-section-heading-mobile md:text-heading-3-16-semibold">
                  {loading ? "..." : String(repositories.length)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Access Tokens</CardDescription>
                <CardTitle className="text-heading-3-16-semibold">
                  Git over HTTPS
                </CardTitle>
              </CardHeader>
              <CardFooter>
                <Button variant="outline" asChild>
                  <Link to="/tokens">查看与吊销</Link>
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </section>

      <section className="page-panel overflow-hidden">
        <div className="panel-toolbar">
          <div className="space-y-1">
            <h2 className="font-display text-heading-3-16-semibold text-text-primary">你的仓库</h2>
            <p className="text-body-sm text-text-secondary">
              包含 owner 和 collaborator 两种角色。
            </p>
          </div>
          <Button asChild>
            <Link to="/repositories/new">新建仓库</Link>
          </Button>
        </div>

        <div className="p-4 md:p-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : loading ? (
            <InlineLoadingState
              title="Loading repositories"
              description="Refreshing your repositories and collaborator access."
            />
          ) : repositories.length === 0 ? (
            <p className="text-body-sm text-text-secondary">还没有仓库，先创建一个。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repositories.map((repo) => {
                  const path = `/repo/${repo.owner_username}/${repo.name}`;
                  return (
                    <TableRow key={repo.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <Link className="gh-link font-display text-heading-4" to={path}>
                            {repo.owner_username}/{repo.name}
                          </Link>
                          <div className="text-body-micro text-text-secondary">
                            {repo.description ?? "No description"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={repo.is_private === 1 ? "destructive" : "outline"}>
                          {repo.is_private === 1 ? "private" : "public"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateTime(repo.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <Link to={path}>查看</Link>
                          </Button>
                          {repo.owner_username === user.username ? (
                            <Button size="sm" variant="ghost" asChild>
                              <Link to={`${path}/settings`}>设置</Link>
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
