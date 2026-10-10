import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { ErrorAlert } from "@/components/common/error-alert";
import { PendingButton } from "@/components/ui/pending-button";
import { Panel } from "@/components/common/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatApiError, login, type AuthUser } from "@/lib/api";

type LoginPageProps = {
  user: AuthUser | null;
  onAuthChanged: () => Promise<void>;
};

export function LoginPage({ user, onAuthChanged }: LoginPageProps) {
  const navigate = useNavigate();
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await login({ usernameOrEmail, password });
      await onAuthChanged();
      navigate("/dashboard", { replace: true });
    } catch (submitError) {
      setError(formatApiError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="登录" />
      <Panel>
        <div className="p-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="usernameOrEmail">用户名或邮箱</Label>
              <Input
                id="usernameOrEmail"
                autoComplete="username"
                value={usernameOrEmail}
                onChange={(event) => setUsernameOrEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <ErrorAlert error={error} title="登录失败" />
            <PendingButton
              className="w-full"
              type="submit"
              pending={submitting}
              pendingText="登录中…"
            >
              登录
            </PendingButton>
          </form>
        </div>
      </Panel>
      <p className="mt-4 text-center text-body-xs text-text-secondary">
        还没有账号？
        <Link to="/register" className="gh-link font-medium">
          注册
        </Link>
      </p>
    </div>
  );
}
