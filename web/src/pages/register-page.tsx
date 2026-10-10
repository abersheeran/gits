import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { ErrorAlert } from "@/components/common/error-alert";
import { PendingButton } from "@/components/ui/pending-button";
import { Panel } from "@/components/common/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatApiError, register, type AuthUser } from "@/lib/api";

type RegisterPageProps = {
  user: AuthUser | null;
  onAuthChanged: () => Promise<void>;
};

export function RegisterPage({ user, onAuthChanged }: RegisterPageProps) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
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
      await register({ username, email, password });
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
      <PageHeader title="注册" />
      <Panel>
        <div className="p-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                aria-describedby="password-hint"
              />
              <p id="password-hint" className="text-body-micro text-text-tertiary">
                至少 8 个字符
              </p>
            </div>
            <ErrorAlert error={error} title="注册失败" />
            <PendingButton
              className="w-full"
              type="submit"
              pending={submitting}
              pendingText="创建中…"
            >
              注册并登录
            </PendingButton>
          </form>
        </div>
      </Panel>
      <p className="mt-4 text-center text-body-xs text-text-secondary">
        已有账号？
        <Link to="/login" className="gh-link font-medium">
          登录
        </Link>
      </p>
    </div>
  );
}
