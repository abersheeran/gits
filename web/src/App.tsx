import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
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

function App() {
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
        <Route path="/repo/:owner/:repo" element={<RepositoryPage user={user} />} />
        <Route path="/repo/:owner/:repo/settings" element={<RepositorySettingsPage user={user} />} />
        <Route
          path="/repo/:owner/:repo/collaborators"
          element={<RepositoryCollaboratorsPage user={user} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default App;
