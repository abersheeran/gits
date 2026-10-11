import { GithubSyncSkeleton } from "./github-sync-skeleton";
import { matchPath, useLocation } from "react-router-dom";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { RepositoryPageSkeleton } from "@/components/common/repository-page-skeleton";
import { TableSkeleton } from "@/components/common/list-skeletons";
import type { AuthUser } from "@/lib/api";

const titles: Record<string, string> = {
  "/": "探索",
  "/dashboard": "我的仓库",
  "/tokens": "访问令牌",
  "/sessions": "登录设备",
  "/login": "登录",
  "/register": "注册",
  "/repositories/new": "新建仓库"
};

export function PageSkeleton({ user }: { user?: AuthUser | null }) {
  const { pathname } = useLocation();
  if (pathname === "/sync" || matchPath("/sync/sources/:sourceId", pathname))
    return <GithubSyncSkeleton source={pathname !== "/sync"} />;
  const match = matchPath("/repo/:owner/:repo/*", pathname);
  if (match?.params.owner && match.params.repo) {
    return (
      <RepositoryPageSkeleton owner={match.params.owner} repo={match.params.repo} user={user} />
    );
  }
  const auth = pathname === "/login" || pathname === "/register";
  const creating = pathname === "/repositories/new";
  const action = pathname === "/dashboard" || pathname === "/tokens" || pathname === "/sessions";
  return (
    <div className={auth ? "mx-auto max-w-md" : creating ? "mx-auto max-w-xl" : undefined}>
      {titles[pathname] && (
        <PageHeader
          title={titles[pathname]}
          action={
            action ? (
              <SkeletonRegion>
                <Skeleton className="h-10 w-[88px] md:h-9" />
              </SkeletonRegion>
            ) : undefined
          }
        />
      )}
      <Panel>
        {auth || creating ? (
          <FormSkeleton
            variant={creating ? "repository" : pathname === "/login" ? "login" : "register"}
          />
        ) : (
          <TableSkeleton variant={pathname === "/sessions" ? "sessions" : pathname === "/tokens" ? "tokens" : "repositories"} />
        )}
      </Panel>
    </div>
  );
}
