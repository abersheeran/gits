import type { AuthUser, RepositoryRecord } from "../types";
import { formatDateTime, shortOid } from "./format";
import { AppShell, type PageNotice } from "./components/app-shell";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  Field,
  LinkButton,
  Select,
  TableWrap
} from "./components/ui";

type RepositoryViewInput = {
  repo: RepositoryRecord;
  user?: AuthUser | undefined;
  notice?: PageNotice | undefined;
  appOrigin: string;
  defaultBranch: string | null;
  selectedRef: string | null;
  branches: Array<{ name: string; oid: string }>;
  readme: { path: string; content: string } | null;
  commits: Array<{
    oid: string;
    message: string;
    author: { timestamp: number; name: string };
  }>;
};

function selectedBranchName(selectedRef: string | null): string | null {
  if (!selectedRef) {
    return null;
  }
  if (selectedRef.startsWith("refs/heads/")) {
    return selectedRef.slice("refs/heads/".length);
  }
  return selectedRef;
}

export function renderRepositoryPage(input: RepositoryViewInput) {
  const repo = input.repo;
  const cloneUrl = `${input.appOrigin.replace(/\/$/, "")}/${repo.owner_username}/${repo.name}.git`;
  const selectedBranch = selectedBranchName(input.selectedRef);

  return (
    <AppShell title={`${repo.owner_username}/${repo.name}`} user={input.user} notice={input.notice}>
      <Card>
        <CardHeader>
          <CardTitle>
            {repo.owner_username}/{repo.name}
          </CardTitle>
          <CardDescription>{repo.description ?? "No description"}</CardDescription>
        </CardHeader>
        <CardContent class="stack">
          <div class="row-actions">
            <Badge tone={repo.is_private === 1 ? "private" : "public"}>
              {repo.is_private === 1 ? "private" : "public"}
            </Badge>
            <span class="muted">default: {input.defaultBranch ?? "none"}</span>
            {selectedBranch ? <span class="muted">selected: {selectedBranch}</span> : null}
            {input.user?.username === repo.owner_username ? (
              <LinkButton href={`/dashboard/repos/${repo.owner_username}/${repo.name}/settings`} variant="secondary">
                管理仓库
              </LinkButton>
            ) : null}
          </div>

          <div>
            <h3 style="margin: 0 0 0.45rem">Clone</h3>
            <div class="table-wrap">
              <div class="mono" style="padding: 0.7rem 0.8rem; display:flex; gap:0.6rem; flex-wrap: wrap; align-items:center">
                <span>{cloneUrl}</span>
                <Button variant="ghost" data-copy={cloneUrl}>
                  复制
                </Button>
              </div>
            </div>
            <p class="hint" style="margin-top: 0.5rem">私有仓库请使用 PAT（HTTP Basic）进行 clone/fetch/push。</p>
          </div>
        </CardContent>
      </Card>

      <div class="grid-two">
        <Card>
          <CardHeader>
            <CardTitle>Branches</CardTitle>
            <CardDescription>切换分支查看提交和 README。</CardDescription>
          </CardHeader>
          <CardContent>
            {input.branches.length === 0 ? (
              <Empty>尚无分支。</Empty>
            ) : (
              <>
                <form method="get" action={`/${repo.owner_username}/${repo.name}`}>
                  <Field>
                    <Select name="ref" defaultValue={selectedBranch ?? ""}>
                      {input.branches.map((branch) => (
                        <option value={branch.name}>{branch.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <div style="margin-top: 0.65rem">
                    <Button type="submit" variant="secondary">
                      切换
                    </Button>
                  </div>
                </form>
                <hr class="hr" />
                <TableWrap>
                  <table>
                    <thead>
                      <tr>
                        <th>Branch</th>
                        <th>Head</th>
                      </tr>
                    </thead>
                    <tbody>
                      {input.branches.map((branch) => (
                        <tr>
                          <td class="mono">{branch.name}</td>
                          <td class="mono muted">{shortOid(branch.oid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Commits</CardTitle>
            <CardDescription>最近 20 条提交。</CardDescription>
          </CardHeader>
          <CardContent>
            {input.commits.length === 0 ? (
              <Empty>当前引用下没有提交记录。</Empty>
            ) : (
              <TableWrap>
                <table>
                  <thead>
                    <tr>
                      <th>Commit</th>
                      <th>Message</th>
                      <th>Author</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {input.commits.map((commit) => (
                      <tr>
                        <td class="mono">{shortOid(commit.oid)}</td>
                        <td>{(commit.message.split("\n")[0] ?? "").trim() || "(no message)"}</td>
                        <td>{commit.author.name}</td>
                        <td>{formatDateTime(commit.author.timestamp * 1000)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>README</CardTitle>
          <CardDescription>{input.readme ? input.readme.path : "README not found"}</CardDescription>
        </CardHeader>
        <CardContent>
          {input.readme ? (
            <pre class="mono" style="white-space: pre-wrap; margin: 0">{input.readme.content}</pre>
          ) : (
            <Empty>当前分支没有可识别的 README 文件。</Empty>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
