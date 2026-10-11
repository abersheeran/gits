import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import { Ban, ExternalLink, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { githubRepositoryIssue } from "@/lib/github-repository-issue";
import { GithubStatusBadge } from "./github-status-badge";
import { IconButton } from "./icon-button";
import type { GithubRepositoryTable } from "./github-repository-table";

type Props = ComponentProps<typeof GithubRepositoryTable> & { manageUrl: string };

export function GithubRepositoryIssues({
  items, pendingId, manageUrl, onSync, onInclude, onExclude, onRename
}: Props) {
  return (
    <ul aria-label="需处理的仓库" className="divide-y divide-border-subtle">
      {items.map((item) => {
        const issue = githubRepositoryIssue(item);
        const pending = pendingId === item.githubRepoId;
        return (
          <li key={item.githubRepoId} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <a className="gh-link min-w-0 break-all text-body-xs" href={item.htmlUrl}
                target="_blank" rel="noreferrer">{item.fullName}</a>
              <GithubStatusBadge status={item.state} />
              {item.repository && (
                <Link className="gh-link min-w-0 break-all text-body-micro"
                  to={`/repo/${encodeURIComponent(item.repository.owner)}/${encodeURIComponent(item.repository.name)}`}>
                  本地：{item.repository.owner}/{item.repository.name}
                </Link>
              )}
            </div>
            <p className="break-words text-body-xs text-text-secondary">{issue.reason}</p>
            {item.lastError && (
              <details className="text-body-micro text-text-secondary">
                <summary className="w-fit cursor-pointer py-2 focus-visible:outline focus-visible:outline-2">
                  错误详情
                </summary>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.lastError}</p>
              </details>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {issue.action === "rename" ? (
                <Button size="sm" variant="outline" disabled={pendingId !== null}
                  onClick={() => onRename(item)}>
                  <Pencil className="size-4" />指定本地名称
                </Button>
              ) : issue.action === "retry" ? (
                <Button size="sm" variant="outline" disabled={pendingId !== null}
                  onClick={() => item.repository ? onSync(item) : onInclude(item)}>
                  <RefreshCw className={`size-4 ${pending ? "motion-safe:animate-spin" : ""}`} />
                  {pending ? "重试中…" : "重试同步"}
                </Button>
              ) : (
                <Button size="sm" variant="outline" asChild>
                  <a href={issue.action === "permissions" ? manageUrl : item.htmlUrl}
                    target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    {issue.action === "permissions" ? "检查 GitHub 授权" : "在 GitHub 查看"}
                  </a>
                </Button>
              )}
              <IconButton label={`${item.repository ? "停止同步" : "排除仓库"} ${item.fullName}`}
                disabled={pendingId !== null} onClick={() => onExclude(item)}>
                <Ban className="size-4" />
              </IconButton>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
