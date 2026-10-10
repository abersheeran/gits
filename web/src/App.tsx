import { Suspense, lazy, useCallback, useEffect, useState, type ComponentType } from "react";
import { Navigate, Route, Routes, matchPath, useLocation } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { PageLoadingState } from "@/components/ui/loading-state";
import { getCurrentUser, type AuthUser } from "@/lib/api";

function lazyPage<TProps>(
  loader: () => Promise<{
    default: ComponentType<TProps>;
  }>
) {
  return lazy(loader);
}

const DashboardPage = lazyPage(async () => ({
  default: (await import("@/pages/dashboard-page")).DashboardPage
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
const TokensPage = lazyPage(async () => ({
  default: (await import("@/pages/tokens-page")).TokensPage
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
    return `Commits · ${repository} · ${APP_NAME}`;
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
    const repository = formatRepositoryName(repoCollaborators.params.owner, repoCollaborators.params.repo);
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
    return `Dashboard · ${APP_NAME}`;
  }
  if (pathname === "/repositories/new") {
    return `新建仓库 · ${APP_NAME}`;
  }
  if (pathname === "/tokens") {
    return `Access Tokens · ${APP_NAME}`;
  }
  if (pathname === "/login") {
    return `登录 · ${APP_NAME}`;
  }
  if (pathname === "/register") {
    return `注册 · ${APP_NAME}`;
  }
  if (pathname === "/") {
    return `首页 · ${APP_NAME}`;
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
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    document.title = titleForPath(location.pathname);
  }, [location.pathname]);

  if (authLoading) {
    return (
      <div className="mx-auto w-[min(1080px,92vw)] py-10">
        <PageLoadingState
          title="Initializing session"
          description="Checking the current account and loading the application shell."
        />
      </div>
    );
  }

  return (
    <AppShell user={user} onAuthChanged={refreshAuth}>
      <Suspense
        fallback={
          <div className="mx-auto w-[min(1080px,92vw)] py-10">
            <PageLoadingState
              title="Loading page"
              description="Fetching the current route bundle and preparing the page."
            />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage user={user} />} />
          <Route path="/login" element={<LoginPage user={user} onAuthChanged={refreshAuth} />} />
          <Route
            path="/register"
            element={<RegisterPage user={user} onAuthChanged={refreshAuth} />}
          />
          <Route path="/dashboard" element={<DashboardPage user={user} />} />
          <Route path="/repositories/new" element={<NewRepositoryPage user={user} />} />
          <Route path="/tokens" element={<TokensPage user={user} />} />
          <Route
            path="/repo/:owner/:repo/settings"
            element={<RepositorySettingsPage user={user} />}
          />
          <Route
            path="/repo/:owner/:repo/collaborators"
            element={<RepositoryCollaboratorsPage user={user} />}
          />
          <Route path="/repo/:owner/:repo/commits" element={<RepositoryCommitsPage user={user} />} />
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
    </AppShell>
  );
}

export default App;
