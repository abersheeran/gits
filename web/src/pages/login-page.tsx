import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
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
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>登录账号</CardTitle>
          <CardDescription>使用用户名或邮箱登录，登录后可创建仓库并管理权限。</CardDescription>
        </CardHeader>
        <CardContent>
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
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>登录失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <PendingButton className="w-full" type="submit" pending={submitting} pendingText="登录中...">
              登录
            </PendingButton>
          </form>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-sm text-muted-foreground">还没有账号？</span>
          <Button variant="outline" asChild>
            <Link to="/register">注册</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
