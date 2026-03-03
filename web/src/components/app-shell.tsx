import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatApiError, logout, type AuthUser } from "@/lib/api";
import { useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type AppShellProps = {
  user: AuthUser | null;
  onAuthChanged: () => Promise<void>;
  children: ReactNode;
};

export function AppShell({ user, onAuthChanged, children }: AppShellProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const navVariant = (
    isActive: boolean,
    inactiveVariant: NonNullable<ButtonProps["variant"]> = "ghost"
  ): NonNullable<ButtonProps["variant"]> => (isActive ? "secondary" : inactiveVariant);

  const isExploreActive = pathname === "/" || pathname.startsWith("/repo/");
  const isDashboardActive =
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/repositories/new" ||
    pathname.startsWith("/repositories/");
  const isTokensActive = pathname === "/tokens" || pathname.startsWith("/tokens/");
  const isActionsSettingsActive =
    pathname === "/settings/actions" || pathname.startsWith("/settings/actions/");
  const isLoginActive = pathname === "/login";
  const isRegisterActive = pathname === "/register";

  async function handleLogout() {
    if (logoutPending) {
      return;
    }

    setLogoutPending(true);
    setLogoutError(null);
    try {
      await logout();
      await onAuthChanged();
      navigate("/");
    } catch (error) {
      setLogoutError(formatApiError(error));
    } finally {
      setLogoutPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-[min(1080px,92vw)] items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
            <img src="/logo.svg" alt="gits logo" className="h-7 w-7 rounded-md" />
            <span>gits</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-2">
            <Button variant={navVariant(isExploreActive)} asChild>
              <Link to="/" aria-current={isExploreActive ? "page" : undefined}>
                Explore
              </Link>
            </Button>
            {user ? (
              <>
                <Button variant={navVariant(isDashboardActive)} asChild>
                  <Link to="/dashboard" aria-current={isDashboardActive ? "page" : undefined}>
                    Dashboard
                  </Link>
                </Button>
                <Button variant={navVariant(isTokensActive)} asChild>
                  <Link to="/tokens" aria-current={isTokensActive ? "page" : undefined}>
                    Tokens
                  </Link>
                </Button>
                <Button variant={navVariant(isActionsSettingsActive)} asChild>
                  <Link
                    to="/settings/actions"
                    aria-current={isActionsSettingsActive ? "page" : undefined}
                  >
                    Actions Config
                  </Link>
                </Button>
                <Button variant="ghost" onClick={handleLogout} disabled={logoutPending}>
                  {logoutPending ? "Signing out..." : `Sign out (${user.username})`}
                </Button>
              </>
            ) : (
              <>
                <Button variant={navVariant(isLoginActive, "outline")} asChild>
                  <Link to="/login" aria-current={isLoginActive ? "page" : undefined}>
                    Sign in
                  </Link>
                </Button>
                <Button variant={navVariant(isRegisterActive)} asChild>
                  <Link to="/register" aria-current={isRegisterActive ? "page" : undefined}>
                    Create account
                  </Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-[min(1080px,92vw)] py-5">
        {logoutError ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>退出失败</AlertTitle>
            <AlertDescription>{logoutError}</AlertDescription>
          </Alert>
        ) : null}
        {children}
      </main>
      <Separator />
      <footer className="mx-auto w-[min(1080px,92vw)] py-4 text-xs text-muted-foreground">
        React SPA + shadcn/ui + Hono API
      </footer>
    </div>
  );
}
