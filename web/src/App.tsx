import { Suspense, lazy, useCallback, useEffect, useState, type ComponentType } from "react";
import { Navigate, Route, Routes, matchPath, useLocation } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { PageSkeleton } from "@/components/common/page-skeleton";
import { repositoryLayoutCache } from "@/lib/repository-layout-cache";
import { getCurrentUser, type AuthUser } from "@/lib/api";

function lazyPage<TProps>(
  loader: () => Promise<{
    default: ComponentType<TProps>;
  }>
) {
  return lazy(loader);
}

const MyRepositoriesPage = lazyPage(async () => ({
  default: (await import("@/pages/dashboard-page")).MyRepositoriesPage
}));
const HomePage = lazyPage(async () => ({
  default: (await import("@/pages/home-page")).HomePage
}));
const LoginPage = lazyPage(async () => ({
  default: (await import("@/pages/login-page")).LoginPage
}));
const NewRepositoryPage = lazyPage(async () => ({
  default: (await import("@/pages/new-repository-page")).NewRepositoryPage
}));
const RegisterPage = lazyPage(async () => ({
  default: (await import("@/pages/register-page")).RegisterPage
}));
const RepositoryBranchesPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-branches-page")).RepositoryBranchesPage
}));
const RepositoryCollaboratorsPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-collaborators-page")).RepositoryCollaboratorsPage
}));
const RepositoryCommitsPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-commits-page")).RepositoryCommitsPage
}));
const RepositoryPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-page")).RepositoryPage
}));
const RepositorySettingsPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-settings-page")).RepositorySettingsPage
}));
const SessionsPage = lazyPage(async () => ({
  default: (await import("@/pages/sessions-page")).SessionsPage
}));
const TokensPage = lazyPage(async () => ({
  default: (await import("@/pages/tokens-page")).TokensPage
}));

const SyncPage = lazyPage(async () => ({ default: (await import("@/pages/sync-page")).SyncPage }));
const SyncSourcePage = lazyPage(async () => ({
  default: (await import("@/pages/sync-source-page")).SyncSourcePage
}));

const APP_NAME = "gits";

function formatRepositoryName(owner?: string, repo?: string): string {
  if (!owner || !repo) {
    return "仓库";
  }
  return `${owner}/${repo}`;
}

function titleForPath(pathname: string): string {
  const commits = matchPath("/repo/:owner/:repo/commits", pathname);
  if (commits) {
    const repository = formatRepositoryName(commits.params.owner, commits.params.repo);
    return `提交 · ${repository} · ${APP_NAME}`;
  }

  const repoBranches = matchPath("/repo/:owner/:repo/branches", pathname);
  if (repoBranches) {
    const repository = formatRepositoryName(repoBranches.params.owner, repoBranches.params.repo);
    return `分支管理 · ${repository} · ${APP_NAME}`;
  }

  const repoSettings = matchPath("/repo/:owner/:repo/settings", pathname);
  if (repoSettings) {
    const repository = formatRepositoryName(repoSettings.params.owner, repoSettings.params.repo);
    return `仓库设置 · ${repository} · ${APP_NAME}`;
  }

  const repoCollaborators = matchPath("/repo/:owner/:repo/collaborators", pathname);
  if (repoCollaborators) {
    const repository = formatRepositoryName(
      repoCollaborators.params.owner,
      repoCollaborators.params.repo
    );
    return `协作者 · ${repository} · ${APP_NAME}`;
  }

  const repoCode = matchPath("/repo/:owner/:repo/:kind/:ref/*", pathname);
  if (repoCode) {
    const repository = formatRepositoryName(repoCode.params.owner, repoCode.params.repo);
    return `${repository} · ${APP_NAME}`;
  }

  const repoRoot = matchPath("/repo/:owner/:repo", pathname);
  if (repoRoot) {
    const repository = formatRepositoryName(repoRoot.params.owner, repoRoot.params.repo);
    return `${repository} · ${APP_NAME}`;
  }

  if (pathname === "/dashboard") {
    return `我的仓库 · ${APP_NAME}`;
  }
  if (pathname === "/repositories/new") {
    return `新建仓库 · ${APP_NAME}`;
  }
  if (pathname === "/sync" || matchPath("/sync/sources/:sourceId", pathname))
    return `GitHub 同步 · ${APP_NAME}`;
  if (pathname === "/sessions") return `登录设备 · ${APP_NAME}`;
  if (pathname === "/tokens") {
    return `访问令牌 · ${APP_NAME}`;
  }
  if (pathname === "/login") {
    return `登录 · ${APP_NAME}`;
  }
  if (pathname === "/register") {
    return `注册 · ${APP_NAME}`;
  }
  if (pathname === "/") {
    return `探索 · ${APP_NAME}`;
  }
  return APP_NAME;
}

function App() {
  const location = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const refreshAuth = useCallback(async () => {
    try {
      setUser(await getCurrentUser());
    } catch {
      setUser(null);
    } finally {
      repositoryLayoutCache.clear();
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
    const onExpired = () => { void refreshAuth(); };
    window.addEventListener("auth-expired", onExpired);
    return () => window.removeEventListener("auth-expired", onExpired);
  }, [refreshAuth]);

  useEffect(() => {
    document.title = titleForPath(location.pathname);
  }, [location.pathname]);

  return (
    <AppShell user={user} authPending={authLoading} onAuthChanged={refreshAuth}>
      {/* AppShell 的 main 已提供 app-container 与页面留白。 */}
      {authLoading ? (
        <PageSkeleton />
      ) : (
        <Suspense fallback={<PageSkeleton user={user} />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage user={user} onAuthChanged={refreshAuth} />} />
            <Route
              path="/register"
              element={<RegisterPage user={user} onAuthChanged={refreshAuth} />}
            />
            <Route path="/sync" element={<SyncPage user={user} />} />
            <Route path="/sync/sources/:sourceId" element={<SyncSourcePage user={user} />} />
            <Route path="/dashboard" element={<MyRepositoriesPage user={user} />} />
            <Route path="/repositories/new" element={<NewRepositoryPage user={user} />} />
            <Route path="/sessions" element={<SessionsPage user={user} />} />
            <Route path="/tokens" element={<TokensPage user={user} />} />
            <Route
              path="/repo/:owner/:repo/settings"
              element={<RepositorySettingsPage user={user} />}
            />
            <Route
              path="/repo/:owner/:repo/collaborators"
              element={<RepositoryCollaboratorsPage user={user} />}
            />
            <Route path="/repo/:owner/:repo/commits" element={<RepositoryCommitsPage />} />
            <Route
              path="/repo/:owner/:repo/branches"
              element={<RepositoryBranchesPage user={user} />}
            />
            <Route path="/repo/:owner/:repo" element={<RepositoryPage user={user} />} />
            <Route
              path="/repo/:owner/:repo/:kind/:ref/*"
              element={<RepositoryPage user={user} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      )}
    </AppShell>
  );
}

export default App;
