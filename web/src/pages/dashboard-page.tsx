import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Repositories</CardTitle>
            <CardDescription>你拥有或协作的仓库数量。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight">{repositories.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access Tokens</CardTitle>
            <CardDescription>用于 Git over HTTPS 认证。</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" asChild>
              <Link to="/tokens">管理 Tokens</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
            <CardTitle>你的仓库</CardTitle>
            <CardDescription>包含 owner 和 collaborator 两种角色。</CardDescription>
          </div>
          <Button asChild>
            <Link to="/repositories/new">新建仓库</Link>
          </Button>
        </CardHeader>
        <CardContent>
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
            <p className="text-sm text-muted-foreground">还没有仓库，先创建一个。</p>
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
                        <div className="font-medium">
                          <Link className="hover:underline" to={path}>
                            {repo.owner_username}/{repo.name}
                          </Link>
                        </div>
                        <div className="text-xs text-muted-foreground">{repo.description ?? "No description"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={repo.is_private === 1 ? "destructive" : "secondary"}>
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
        </CardContent>
      </Card>
    </div>
  );
}
