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
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>创建账号</CardTitle>
          <CardDescription>账号创建后自动登录。密码长度至少 8 位。</CardDescription>
        </CardHeader>
        <CardContent>
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
              <p className="text-xs text-muted-foreground">
                允许字母、数字和 . _ -，长度 1-32，首尾不能是标点。
              </p>
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
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>注册失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <PendingButton
              className="w-full"
              type="submit"
              pending={submitting}
              pendingText="创建中..."
            >
              注册并登录
            </PendingButton>
          </form>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-sm text-muted-foreground">已有账号？</span>
          <Button variant="outline" asChild>
            <Link to="/login">去登录</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
