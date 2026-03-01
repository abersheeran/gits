import { AppShell, type PageNotice } from "./components/app-shell";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  LinkButton
} from "./components/ui";

type LoginPageInput = {
  notice?: PageNotice | undefined;
  values?: {
    usernameOrEmail?: string;
  };
};

export function renderLoginPage(input: LoginPageInput = {}) {
  return (
    <AppShell title="登录" notice={input.notice}>
      <Card>
        <CardHeader>
          <CardTitle>登录账号</CardTitle>
          <CardDescription>使用用户名或邮箱登录，登录后可创建仓库、管理协作者和访问令牌。</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/auth/login">
            <Field>
              <Label htmlFor="usernameOrEmail">用户名或邮箱</Label>
              <Input
                id="usernameOrEmail"
                name="usernameOrEmail"
                type="text"
                required
                autoComplete="username"
                value={input.values?.usernameOrEmail ?? ""}
              />
            </Field>
            <Field>
              <Label htmlFor="password">密码</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </Field>
            <div style="margin-top: 1rem">
              <Button type="submit">登录</Button>
            </div>
          </form>
        </CardContent>
        <CardFooter>
          <span class="muted">还没有账号？</span>
          <LinkButton href="/auth/register" variant="secondary">
            注册
          </LinkButton>
        </CardFooter>
      </Card>
    </AppShell>
  );
}

type RegisterPageInput = {
  notice?: PageNotice | undefined;
  values?: {
    username?: string;
    email?: string;
  };
};

export function renderRegisterPage(input: RegisterPageInput = {}) {
  return (
    <AppShell title="注册" notice={input.notice}>
      <Card>
        <CardHeader>
          <CardTitle>创建账号</CardTitle>
          <CardDescription>账号创建后会自动登录。密码要求至少 8 位。</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/auth/register">
            <Field>
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                value={input.values?.username ?? ""}
              />
              <p class="hint">允许字母、数字和 . _ -，长度 1-32，且首尾不能是标点。</p>
            </Field>
            <Field>
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={input.values?.email ?? ""}
              />
            </Field>
            <Field>
              <Label htmlFor="password">密码</Label>
              <Input id="password" name="password" type="password" required autoComplete="new-password" minLength={8} />
            </Field>
            <div style="margin-top: 1rem">
              <Button type="submit">注册并登录</Button>
            </div>
          </form>
        </CardContent>
        <CardFooter>
          <span class="muted">已有账号？</span>
          <LinkButton href="/auth/login" variant="secondary">
            去登录
          </LinkButton>
        </CardFooter>
      </Card>
    </AppShell>
  );
}
