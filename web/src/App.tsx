import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, matchPath, useLocation } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser, type AuthUser } from "@/lib/api";
import { DashboardPage } from "@/pages/dashboard-page";
import { HomePage } from "@/pages/home-page";
import { LoginPage } from "@/pages/login-page";
import { NewRepositoryPage } from "@/pages/new-repository-page";
import { RegisterPage } from "@/pages/register-page";
import { RepositoryCollaboratorsPage } from "@/pages/repository-collaborators-page";
import { RepositoryPage } from "@/pages/repository-page";
import { RepositorySettingsPage } from "@/pages/repository-settings-page";
import { TokensPage } from "@/pages/tokens-page";

const APP_NAME = "gits";

function formatRepositoryName(owner?: string, repo?: string): string {
  if (!owner || !repo) {
    return "仓库";
  }
  return `${owner}/${repo}`;
}

function titleForPath(pathname: string): string {
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
    return <div className="mx-auto w-[min(1080px,92vw)] py-10 text-sm text-muted-foreground">正在初始化...</div>;
  }

  return (
    <AppShell user={user} onAuthChanged={refreshAuth}>
      <Routes>
        <Route path="/" element={<HomePage user={user} />} />
        <Route path="/login" element={<LoginPage user={user} onAuthChanged={refreshAuth} />} />
        <Route path="/register" element={<RegisterPage user={user} onAuthChanged={refreshAuth} />} />
        <Route path="/dashboard" element={<DashboardPage user={user} />} />
        <Route path="/repositories/new" element={<NewRepositoryPage user={user} />} />
        <Route path="/tokens" element={<TokensPage user={user} />} />
        <Route path="/repo/:owner/:repo/settings" element={<RepositorySettingsPage user={user} />} />
        <Route
          path="/repo/:owner/:repo/collaborators"
          element={<RepositoryCollaboratorsPage user={user} />}
        />
        <Route path="/repo/:owner/:repo" element={<RepositoryPage user={user} />} />
        <Route path="/repo/:owner/:repo/:kind/:ref/*" element={<RepositoryPage user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default App;
