import type { AccessTokenMetadata } from "../services/auth-service";
import type { AuthUser, RepositoryRecord } from "../types";
import { formatDateTime } from "./format";
import { AppShell, type PageNotice } from "./components/app-shell";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Empty,
  Field,
  Input,
  Label,
  LinkButton,
  Select,
  TableWrap,
  Textarea
} from "./components/ui";

type DashboardHomeInput = {
  user: AuthUser;
  repositories: RepositoryRecord[];
  notice?: PageNotice | undefined;
};

export function renderDashboardHome(input: DashboardHomeInput) {
  return (
    <AppShell title="Dashboard" user={input.user} notice={input.notice}>
      <div class="grid-three">
        <Card>
          <CardHeader>
            <CardTitle>Repositories</CardTitle>
            <CardDescription>管理你拥有或协作的仓库。</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="mono" style="font-size: 1.1rem">
              {input.repositories.length}
            </div>
          </CardContent>
          <CardFooter>
            <LinkButton href="/dashboard/repos/new">新建仓库</LinkButton>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access Tokens</CardTitle>
            <CardDescription>用于 HTTPS Git 凭据（HTTP Basic）。</CardDescription>
          </CardHeader>
          <CardFooter>
            <LinkButton href="/dashboard/tokens" variant="secondary">
              管理 Token
            </LinkButton>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
            <CardDescription>
              创建仓库后即可通过 <code>git remote add</code> 绑定远端并 push。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p class="hint">仓库详情页会显示完整 clone URL。</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>你的仓库</CardTitle>
          <CardDescription>包含你是 owner 或 collaborator 的仓库。</CardDescription>
        </CardHeader>
        <CardContent>
          {input.repositories.length === 0 ? (
            <Empty>还没有仓库。先创建一个私有仓库试试。</Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Visibility</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {input.repositories.map((repo) => (
                    <tr>
                      <td>
                        <a href={`/${repo.owner_username}/${repo.name}`}>
                          {repo.owner_username}/{repo.name}
                        </a>
                        <div class="muted">{repo.description ?? "No description"}</div>
                      </td>
                      <td>
                        <Badge tone={repo.is_private === 1 ? "private" : "public"}>
                          {repo.is_private === 1 ? "private" : "public"}
                        </Badge>
                      </td>
                      <td>{formatDateTime(repo.created_at)}</td>
                      <td>
                        <div class="row-actions">
                          <LinkButton href={`/${repo.owner_username}/${repo.name}`} variant="secondary">
                            查看
                          </LinkButton>
                          {repo.owner_username === input.user.username ? (
                            <LinkButton href={`/dashboard/repos/${repo.owner_username}/${repo.name}/settings`} variant="ghost">
                              设置
                            </LinkButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

type NewRepoPageInput = {
  user: AuthUser;
  notice?: PageNotice | undefined;
  values?: {
    name?: string;
    description?: string;
    isPrivate?: boolean;
  };
};

export function renderNewRepositoryPage(input: NewRepoPageInput) {
  return (
    <AppShell title="新建仓库" user={input.user} notice={input.notice}>
      <Card>
        <CardHeader>
          <CardTitle>创建仓库</CardTitle>
          <CardDescription>仓库名不能以 .git 结尾，支持字母、数字和 . _ -。</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/dashboard/repos">
            <Field>
              <Label htmlFor="name">仓库名</Label>
              <Input id="name" name="name" required value={input.values?.name ?? ""} />
            </Field>
            <Field>
              <Label htmlFor="description">描述</Label>
              <Textarea id="description" name="description">
                {input.values?.description ?? ""}
              </Textarea>
            </Field>
            <Field>
              <label class="check-row" htmlFor="isPrivate">
                <input
                  id="isPrivate"
                  name="isPrivate"
                  type="checkbox"
                  value="1"
                  checked={input.values?.isPrivate ?? true}
                />
                私有仓库
              </label>
            </Field>
            <div style="margin-top: 1rem" class="row-actions">
              <Button type="submit">创建</Button>
              <LinkButton href="/dashboard" variant="ghost">
                返回
              </LinkButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}

type RepoSettingsPageInput = {
  user: AuthUser;
  repo: RepositoryRecord;
  appOrigin: string;
  notice?: PageNotice | undefined;
  values?: {
    name?: string;
    description?: string;
    isPrivate?: boolean;
  };
};

export function renderRepoSettingsPage(input: RepoSettingsPageInput) {
  const cloneUrl = `${input.appOrigin.replace(/\/$/, "")}/${input.repo.owner_username}/${input.repo.name}.git`;

  return (
    <AppShell title="仓库设置" user={input.user} notice={input.notice}>
      <Card>
        <CardHeader>
          <CardTitle>
            仓库设置: {input.repo.owner_username}/{input.repo.name}
          </CardTitle>
          <CardDescription>更新仓库名、描述和可见性。</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="hint">当前 clone URL：</p>
          <div class="table-wrap" style="margin-bottom: 1rem">
            <div class="mono" style="padding: 0.68rem 0.8rem; display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center">
              <span>{cloneUrl}</span>
              <Button variant="ghost" data-copy={cloneUrl}>
                复制
              </Button>
            </div>
          </div>

          <form method="post" action={`/dashboard/repos/${input.repo.owner_username}/${input.repo.name}/settings`}>
            <Field>
              <Label htmlFor="name">仓库名</Label>
              <Input id="name" name="name" required value={input.values?.name ?? input.repo.name} />
            </Field>
            <Field>
              <Label htmlFor="description">描述</Label>
              <Textarea id="description" name="description">
                {input.values?.description ?? input.repo.description ?? ""}
              </Textarea>
            </Field>
            <Field>
              <label class="check-row" htmlFor="isPrivate">
                <input
                  id="isPrivate"
                  name="isPrivate"
                  type="checkbox"
                  value="1"
                  checked={input.values?.isPrivate ?? input.repo.is_private === 1}
                />
                私有仓库
              </label>
            </Field>
            <div style="margin-top: 1rem" class="row-actions">
              <Button type="submit">保存</Button>
              <LinkButton href={`/dashboard/repos/${input.repo.owner_username}/${input.repo.name}/collaborators`} variant="secondary">
                管理协作者
              </LinkButton>
              <LinkButton href={`/${input.repo.owner_username}/${input.repo.name}`} variant="ghost">
                查看仓库
              </LinkButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card class="danger-zone">
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>删除后不可恢复，仓库对象也会从存储中移除。</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action={`/dashboard/repos/${input.repo.owner_username}/${input.repo.name}/delete`}>
            <Field>
              <Label htmlFor="confirmRepoName">输入仓库名确认删除</Label>
              <Input id="confirmRepoName" name="confirmRepoName" required placeholder={input.repo.name} />
            </Field>
            <div style="margin-top: 1rem">
              <Button type="submit" variant="danger">
                删除仓库
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}

type CollaboratorRecord = {
  user_id: string;
  username: string;
  permission: string;
  created_at: number;
};

type CollaboratorsPageInput = {
  user: AuthUser;
  repo: RepositoryRecord;
  notice?: PageNotice | undefined;
  collaborators: CollaboratorRecord[];
  values?: {
    username?: string;
    permission?: "read" | "write" | "admin";
  };
};

export function renderCollaboratorsPage(input: CollaboratorsPageInput) {
  return (
    <AppShell title="协作者管理" user={input.user} notice={input.notice}>
      <Card>
        <CardHeader>
          <CardTitle>
            协作者: {input.repo.owner_username}/{input.repo.name}
          </CardTitle>
          <CardDescription>权限分为 read / write / admin，owner 默认拥有全部权限。</CardDescription>
        </CardHeader>
        <CardContent class="stack">
          <form method="post" action={`/dashboard/repos/${input.repo.owner_username}/${input.repo.name}/collaborators`}>
            <div class="grid-two">
              <Field>
                <Label htmlFor="username">用户名</Label>
                <Input id="username" name="username" required value={input.values?.username ?? ""} />
              </Field>
              <Field>
                <Label htmlFor="permission">权限</Label>
                <Select id="permission" name="permission" defaultValue={input.values?.permission ?? "read"}>
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="admin">admin</option>
                </Select>
              </Field>
            </div>
            <div style="margin-top: 0.9rem" class="row-actions">
              <Button type="submit">添加或更新</Button>
              <LinkButton href={`/dashboard/repos/${input.repo.owner_username}/${input.repo.name}/settings`} variant="ghost">
                返回设置
              </LinkButton>
            </div>
          </form>

          {input.collaborators.length === 0 ? (
            <Empty>暂无协作者。</Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Permission</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {input.collaborators.map((item) => (
                    <tr>
                      <td>{item.username}</td>
                      <td>
                        <Badge>{item.permission}</Badge>
                      </td>
                      <td>{formatDateTime(item.created_at)}</td>
                      <td>
                        <form
                          method="post"
                          action={`/dashboard/repos/${input.repo.owner_username}/${input.repo.name}/collaborators/${item.username}/delete`}
                          style="margin:0"
                        >
                          <Button type="submit" variant="ghost">
                            移除
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

type TokensPageInput = {
  user: AuthUser;
  notice?: PageNotice | undefined;
  tokens: AccessTokenMetadata[];
  createdToken?: string;
  values?: {
    name?: string;
    expiresAt?: string;
  };
};

export function renderTokensPage(input: TokensPageInput) {
  return (
    <AppShell title="Access Tokens" user={input.user} notice={input.notice}>
      <Card>
        <CardHeader>
          <CardTitle>创建 Access Token</CardTitle>
          <CardDescription>Token 仅展示一次，请立即保存。</CardDescription>
        </CardHeader>
        <CardContent>
          {input.createdToken ? (
            <div class="alert alert-success" style="margin-bottom: 1rem">
              <div>新 Token（仅本次可见）</div>
              <div class="mono" style="margin-top: 0.45rem; display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap">
                <span>{input.createdToken}</span>
                <Button variant="ghost" data-copy={input.createdToken}>
                  复制
                </Button>
              </div>
            </div>
          ) : null}

          <form method="post" action="/dashboard/tokens">
            <div class="grid-two">
              <Field>
                <Label htmlFor="name">名称</Label>
                <Input id="name" name="name" required value={input.values?.name ?? ""} placeholder="laptop" />
              </Field>
              <Field>
                <Label htmlFor="expiresAt">过期时间（可选，毫秒时间戳）</Label>
                <Input id="expiresAt" name="expiresAt" type="number" value={input.values?.expiresAt ?? ""} />
              </Field>
            </div>
            <div style="margin-top: 0.9rem" class="row-actions">
              <Button type="submit">创建 Token</Button>
              <LinkButton href="/dashboard" variant="ghost">
                返回控制台
              </LinkButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Token 列表</CardTitle>
          <CardDescription>已吊销或过期的 Token 不可用于 Git 认证。</CardDescription>
        </CardHeader>
        <CardContent>
          {input.tokens.length === 0 ? (
            <Empty>暂无 token。</Empty>
          ) : (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Last Used</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {input.tokens.map((token) => {
                    const expired = token.expires_at !== null && token.expires_at <= Date.now();
                    const revoked = token.revoked_at !== null;
                    const status = revoked ? "revoked" : expired ? "expired" : "active";
                    return (
                      <tr>
                        <td>{token.name}</td>
                        <td class="mono">{token.token_prefix}</td>
                        <td>{formatDateTime(token.created_at)}</td>
                        <td>{formatDateTime(token.expires_at)}</td>
                        <td>{formatDateTime(token.last_used_at)}</td>
                        <td>
                          <Badge>{status}</Badge>
                        </td>
                        <td>
                          {revoked ? (
                            <span class="muted">-</span>
                          ) : (
                            <form method="post" action={`/dashboard/tokens/${token.id}/revoke`} style="margin:0">
                              <Button type="submit" variant="ghost">
                                吊销
                              </Button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
