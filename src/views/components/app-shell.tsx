import type { Child } from "hono/jsx";
import type { AuthUser } from "../../types";
import { appStyles } from "../theme";
import { Button, LinkButton, Alert } from "./ui";

export type PageNotice = {
  tone: "info" | "success" | "error";
  message: string;
};

type AppShellProps = {
  title: string;
  user?: AuthUser | undefined;
  notice?: PageNotice | undefined;
  children: Child;
};

export function AppShell(props: AppShellProps) {
  const { title, user, notice, children } = props;

  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · gits</title>
        <style>{appStyles}</style>
      </head>
      <body>
        <div class="topbar-wrap">
          <header class="container topbar">
            <a class="brand" href="/">
              <span class="brand-mark">gt</span>
              <span class="brand-text">gits</span>
            </a>
            <nav class="nav-row">
              <LinkButton href="/" variant="ghost">
                Explore
              </LinkButton>
              {user ? (
                <>
                  <LinkButton href="/dashboard" variant="secondary">
                    Dashboard
                  </LinkButton>
                  <LinkButton href="/dashboard/repos/new" variant="ghost">
                    New Repo
                  </LinkButton>
                  <LinkButton href="/dashboard/tokens" variant="ghost">
                    Access Tokens
                  </LinkButton>
                  <form method="post" action="/auth/logout" style="display:inline-flex; margin:0">
                    <Button variant="ghost" type="submit">
                      Sign Out ({user.username})
                    </Button>
                  </form>
                </>
              ) : (
                <>
                  <LinkButton href="/auth/login" variant="secondary">
                    Sign In
                  </LinkButton>
                  <LinkButton href="/auth/register">Create Account</LinkButton>
                </>
              )}
            </nav>
          </header>
        </div>

        <main class="container stack" style="padding: 1.15rem 0 0.25rem">
          {notice ? <Alert tone={notice.tone}>{notice.message}</Alert> : null}
          {children}
        </main>

        <footer class="container footer">Cloudflare Workers · Hono JSX · shadcn inspired UI</footer>

        <script>
          {`document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const trigger = target.closest("[data-copy]");
  if (!trigger) return;
  const value = trigger.getAttribute("data-copy");
  if (!value || !navigator.clipboard) return;
  await navigator.clipboard.writeText(value);
  trigger.setAttribute("data-copied", "1");
  setTimeout(() => trigger.removeAttribute("data-copied"), 1400);
});`}
        </script>
      </body>
    </html>
  );
}
