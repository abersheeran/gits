import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatApiError, logout, type AuthUser } from "@/lib/api";
import { useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

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
    <div className="min-h-screen bg-surface-canvas">
      <header className="sticky top-0 z-20 px-0 py-3 md:py-4">
        <div className="app-container">
          <div className="page-panel overflow-hidden bg-surface-base px-4 py-4 backdrop-blur md:px-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link to="/" className="inline-flex items-center gap-3">
                  <img src="/logo.svg" alt="gits logo" className="h-10 w-10 rounded-[14px]" />
                  <div className="space-y-0.5">
                    <p className="font-display text-heading-3-16-semibold text-text-primary">gits</p>
                    <p className="text-body-micro text-text-secondary">
                      Agent-native delivery chain
                    </p>
                  </div>
                </Link>
                {user ? (
                  <div className="rounded-full border border-border-subtle bg-surface-focus px-3 py-1.5 text-label-xs text-text-supporting">
                    Signed in as <span className="text-text-primary">{user.username}</span>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
                <nav
                  className="flex max-w-full flex-wrap items-center gap-1 rounded-full bg-surface-focus p-1"
                  aria-label="Primary"
                >
                  <Button
                    variant="ghost"
                    className={cn(
                      "h-9 px-4 text-button-md",
                      isExploreActive && "bg-surface-base shadow-sm hover:bg-surface-base"
                    )}
                    asChild
                  >
                    <Link to="/" aria-current={isExploreActive ? "page" : undefined}>
                      Explore
                    </Link>
                  </Button>
                  {user ? (
                    <>
                      <Button
                        variant="ghost"
                        className={cn(
                          "h-9 px-4 text-button-md",
                          isDashboardActive && "bg-surface-base shadow-sm hover:bg-surface-base"
                        )}
                        asChild
                      >
                        <Link to="/dashboard" aria-current={isDashboardActive ? "page" : undefined}>
                          Dashboard
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        className={cn(
                          "h-9 px-4 text-button-md",
                          isTokensActive && "bg-surface-base shadow-sm hover:bg-surface-base"
                        )}
                        asChild
                      >
                        <Link to="/tokens" aria-current={isTokensActive ? "page" : undefined}>
                          Tokens
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        className={cn(
                          "h-9 px-4 text-button-md",
                          isActionsSettingsActive &&
                            "bg-surface-base shadow-sm hover:bg-surface-base"
                        )}
                        asChild
                      >
                        <Link
                          to="/settings/actions"
                          aria-current={isActionsSettingsActive ? "page" : undefined}
                        >
                          Actions
                        </Link>
                      </Button>
                    </>
                  ) : null}
                </nav>

                <div className="flex flex-wrap items-center gap-2">
                  {user ? (
                    <Button variant="outline" onClick={handleLogout} disabled={logoutPending}>
                      {logoutPending ? "Signing out..." : "Sign out"}
                    </Button>
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
                </div>
              </div>
            </div>

            {logoutError ? (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>退出失败</AlertTitle>
                <AlertDescription>{logoutError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </header>

      <main className="app-container py-3 md:py-4">{children}</main>

      <div className="app-container pb-6 pt-8">
        <Separator />
        <footer className="flex flex-col gap-1 py-4 text-body-micro text-text-secondary md:flex-row md:items-center md:justify-between">
          <span>React SPA + Hono API + Cloudflare runtime</span>
          <span>Warm-neutral shell aligned with the current design system</span>
        </footer>
      </div>
    </div>
  );
}
