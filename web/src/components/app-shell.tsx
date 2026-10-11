import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import { Menu } from "lucide-react";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from "@/components/ui/sheet";
import { IconButton } from "@/components/common/icon-button";
import { ErrorAlert } from "@/components/common/error-alert";
import { formatApiError, logout, type AuthUser } from "@/lib/api";
import { cn } from "@/lib/utils";
export function AppShell({
  user,
  authPending = false,
  onAuthChanged,
  children
}: {
  user: AuthUser | null;
  authPending?: boolean;
  onAuthChanged: () => Promise<void>;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [
    ["/", "探索"],
    ...(user
      ? [
          ["/dashboard", "我的仓库"],
          ["/sync", "同步"],
          ["/tokens", "访问令牌"]
        ]
      : [])
  ];
  const navigation = (
    <nav aria-label="主导航" className="flex flex-col gap-1 md:flex-row">
      {items.map(([path, label]) => {
        const active =
          pathname === path ||
          (path === "/sync" && pathname.startsWith("/sync/sources/")) ||
          (path === "/dashboard" && pathname === "/repositories/new");
        return (
          <Link
            key={path}
            to={path}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-3 text-body-xs md:py-2",
              active
                ? "bg-surface-focus text-text-primary"
                : "text-text-secondary hover:bg-surface-hover"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
  const account = (mobile = false) => (
    <div className={cn("flex gap-3", mobile ? "flex-col items-stretch" : "flex-wrap items-center")}>
      {authPending ? (
        <SkeletonRegion className="flex items-center gap-2">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="h-3.5 w-20" />
        </SkeletonRegion>
      ) : user ? (
        <>
          <span
            className={cn(
              "flex min-w-0 items-center gap-2 text-body-xs",
              mobile ? "px-3" : "max-w-40"
            )}
          >
            <AuthorAvatar name={user.username} className="h-7 w-7 shrink-0" />
            <span className="truncate">{user.username}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className={mobile ? "w-full justify-start px-3" : undefined}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await logout();
                await onAuthChanged();
                setOpen(false);
                navigate("/");
              } catch (cause) {
                setError(formatApiError(cause));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "退出中…" : "退出"}
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="ghost"
            className={mobile ? "w-full justify-start px-3" : undefined}
            asChild
          >
            <Link to="/login" onClick={() => setOpen(false)}>
              登录
            </Link>
          </Button>
          <Button size="sm" className={mobile ? "w-full justify-start px-3" : undefined} asChild>
            <Link to="/register" onClick={() => setOpen(false)}>
              注册
            </Link>
          </Button>
        </>
      )}
    </div>
  );
  return (
    <div className="min-h-screen bg-surface-canvas">
      <header className="h-14 border-b border-border bg-surface-base">
        <div className="app-container flex h-full items-center gap-6">
          <Link to="/" className="flex items-center gap-2 font-display font-semibold">
            <img src="/logo.svg" alt="" className="h-8 w-8" />
            gits
          </Link>
          <div className="hidden md:block">{navigation}</div>
          <div className="ml-auto hidden md:block">{account()}</div>
          <IconButton label="打开菜单" className="ml-auto md:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </IconButton>
        </div>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[min(320px,100vw)] rounded-l-xl p-4">
          <SheetHeader className="mb-6 pl-3 pr-10">
            <SheetTitle>gits</SheetTitle>
            <SheetDescription className="sr-only">导航与账户</SheetDescription>
          </SheetHeader>
          {navigation}
          <div className="mt-4 border-t border-border-subtle pt-4">{account(true)}</div>
          <ErrorAlert error={error} />
        </SheetContent>
      </Sheet>
      <main className="app-container min-w-0 py-6 md:py-8">
        <ErrorAlert error={error} />
        {children}
      </main>
    </div>
  );
}
