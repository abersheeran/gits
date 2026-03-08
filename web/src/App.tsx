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
const AgentSessionDetailPage = lazyPage(async () => ({
  default: (await import("@/pages/agent-session-detail-page")).AgentSessionDetailPage
}));
const IssueDetailPage = lazyPage(async () => ({
  default: (await import("@/pages/issue-detail-page")).IssueDetailPage
}));
const LoginPage = lazyPage(async () => ({
  default: (await import("@/pages/login-page")).LoginPage
}));
const ActionsSettingsPage = lazyPage(async () => ({
  default: (await import("@/pages/actions-settings-page")).ActionsSettingsPage
}));
const NewIssuePage = lazyPage(async () => ({
  default: (await import("@/pages/new-issue-page")).NewIssuePage
}));
const NewPullRequestPage = lazyPage(async () => ({
  default: (await import("@/pages/new-pull-request-page")).NewPullRequestPage
}));
const NewRepositoryPage = lazyPage(async () => ({
  default: (await import("@/pages/new-repository-page")).NewRepositoryPage
}));
const PullRequestDetailPage = lazyPage(async () => ({
  default: (await import("@/pages/pull-request-detail-page")).PullRequestDetailPage
}));
const RegisterPage = lazyPage(async () => ({
  default: (await import("@/pages/register-page")).RegisterPage
}));
const RepositoryActionsPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-actions-page")).RepositoryActionsPage
}));
const RepositoryCollaboratorsPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-collaborators-page")).RepositoryCollaboratorsPage
}));
const RepositoryCommitsPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-commits-page")).RepositoryCommitsPage
}));
const RepositoryIssuesPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-issues-page")).RepositoryIssuesPage
}));
const RepositoryPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-page")).RepositoryPage
}));
const RepositoryPullsPage = lazyPage(async () => ({
  default: (await import("@/pages/repository-pulls-page")).RepositoryPullsPage
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
  const newIssue = matchPath("/repo/:owner/:repo/issues/new", pathname);
  if (newIssue) {
    const repository = formatRepositoryName(newIssue.params.owner, newIssue.params.repo);
    return `New Issue · ${repository} · ${APP_NAME}`;
  }

  const issueDetail = matchPath("/repo/:owner/:repo/issues/:number", pathname);
  if (issueDetail) {
    const repository = formatRepositoryName(issueDetail.params.owner, issueDetail.params.repo);
    return `Issue #${issueDetail.params.number} · ${repository} · ${APP_NAME}`;
  }

  const issues = matchPath("/repo/:owner/:repo/issues", pathname);
  if (issues) {
    const repository = formatRepositoryName(issues.params.owner, issues.params.repo);
    return `Issues · ${repository} · ${APP_NAME}`;
  }

  const newPullRequest = matchPath("/repo/:owner/:repo/pulls/new", pathname);
  if (newPullRequest) {
    const repository = formatRepositoryName(newPullRequest.params.owner, newPullRequest.params.repo);
    return `New Pull Request · ${repository} · ${APP_NAME}`;
  }

  const pullRequestDetail = matchPath("/repo/:owner/:repo/pulls/:number", pathname);
  if (pullRequestDetail) {
    const repository = formatRepositoryName(pullRequestDetail.params.owner, pullRequestDetail.params.repo);
    return `Pull Request #${pullRequestDetail.params.number} · ${repository} · ${APP_NAME}`;
  }

  const agentSessionDetail = matchPath("/repo/:owner/:repo/agent-sessions/:sessionId", pathname);
  if (agentSessionDetail) {
    const repository = formatRepositoryName(
      agentSessionDetail.params.owner,
      agentSessionDetail.params.repo
    );
    return `Agent Session · ${repository} · ${APP_NAME}`;
  }

  const pulls = matchPath("/repo/:owner/:repo/pulls", pathname);
  if (pulls) {
    const repository = formatRepositoryName(pulls.params.owner, pulls.params.repo);
    return `Pull Requests · ${repository} · ${APP_NAME}`;
  }

  const commits = matchPath("/repo/:owner/:repo/commits", pathname);
  if (commits) {
    const repository = formatRepositoryName(commits.params.owner, commits.params.repo);
    return `Commits · ${repository} · ${APP_NAME}`;
  }

  const actions = matchPath("/repo/:owner/:repo/actions", pathname);
  if (actions) {
    const repository = formatRepositoryName(actions.params.owner, actions.params.repo);
    return `Actions · ${repository} · ${APP_NAME}`;
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
  if (pathname === "/settings/actions") {
    return `Actions Config · ${APP_NAME}`;
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
          <Route path="/settings/actions" element={<ActionsSettingsPage user={user} />} />
          <Route
            path="/repo/:owner/:repo/settings"
            element={<RepositorySettingsPage user={user} />}
          />
          <Route
            path="/repo/:owner/:repo/collaborators"
            element={<RepositoryCollaboratorsPage user={user} />}
          />
          <Route path="/repo/:owner/:repo/commits" element={<RepositoryCommitsPage user={user} />} />
          <Route path="/repo/:owner/:repo/issues" element={<RepositoryIssuesPage user={user} />} />
          <Route path="/repo/:owner/:repo/issues/new" element={<NewIssuePage user={user} />} />
          <Route
            path="/repo/:owner/:repo/issues/:number"
            element={<IssueDetailPage user={user} />}
          />
          <Route path="/repo/:owner/:repo/pulls" element={<RepositoryPullsPage user={user} />} />
          <Route
            path="/repo/:owner/:repo/pulls/new"
            element={<NewPullRequestPage user={user} />}
          />
          <Route
            path="/repo/:owner/:repo/pulls/:number"
            element={<PullRequestDetailPage user={user} />}
          />
          <Route
            path="/repo/:owner/:repo/agent-sessions/:sessionId"
            element={<AgentSessionDetailPage user={user} />}
          />
          <Route
            path="/repo/:owner/:repo/actions"
            element={<RepositoryActionsPage user={user} />}
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
