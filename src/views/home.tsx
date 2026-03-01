import type { AuthUser, RepositoryRecord } from "../types";
import { AppShell, type PageNotice } from "./components/app-shell";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  LinkButton
} from "./components/ui";

type HomePageInput = {
  repositories: RepositoryRecord[];
  user?: AuthUser | undefined;
  notice?: PageNotice | undefined;
};

export function renderHomePage(input: HomePageInput) {
  const { repositories, user, notice } = input;

  return (
    <AppShell title="Explore" user={user} notice={notice}>
      <section class="hero">
        <h1>一个可自托管的 Git 工作台</h1>
        <p>
          浏览公开仓库、查看分支与提交、管理私有仓库权限。所有页面均基于 Hono JSX 服务端渲染，并采用 shadcn 风格组件体系。
        </p>
        <div class="row-actions" style="margin-top: 0.9rem">
          {user ? (
            <>
              <LinkButton href="/dashboard">进入控制台</LinkButton>
              <LinkButton href="/dashboard/repos/new" variant="secondary">
                创建仓库
              </LinkButton>
            </>
          ) : (
            <>
              <LinkButton href="/auth/register">注册账号</LinkButton>
              <LinkButton href="/auth/login" variant="secondary">
                登录
              </LinkButton>
            </>
          )}
        </div>
      </section>

      <div class="stack">
        <h2 class="section-title">Public Repositories</h2>
        {repositories.length === 0 ? (
          <Empty>暂无公开仓库，可先注册并创建一个公开仓库。</Empty>
        ) : (
          <div class="grid-two">
            {repositories.map((repo) => (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <a href={`/${repo.owner_username}/${repo.name}`}>
                      {repo.owner_username}/{repo.name}
                    </a>
                  </CardTitle>
                  <CardDescription>{repo.description ?? "No description"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge tone={repo.is_private === 1 ? "private" : "public"}>
                    {repo.is_private === 1 ? "private" : "public"}
                  </Badge>
                </CardContent>
                <CardFooter>
                  <LinkButton href={`/${repo.owner_username}/${repo.name}`} variant="secondary">
                    查看详情
                  </LinkButton>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
