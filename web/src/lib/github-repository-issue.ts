import type { GithubRemoteRepository } from "./github-api";
import { githubErrorMessage } from "./github-errors";

type RepositoryIssue = {
  reason: string;
  action: "rename" | "retry" | "permissions" | "github";
};

export function githubRepositoryIssue(item: GithubRemoteRepository): RepositoryIssue {
  if (item.state === "name_conflict") {
    return {
      reason: item.lastError?.startsWith("Invalid repository name")
        ? "生成的本地仓库名不符合命名规则，请指定其他名称。"
        : "本地仓库名已被占用，请指定其他名称后同步。",
      action: "rename"
    };
  }
  if (item.state === "too_large") {
    return {
      reason: "仓库超过 10 GB 同步上限，无法同步。可在 GitHub 查看仓库，或将其排除。",
      action: "github"
    };
  }
  if (item.state === "missing") {
    return {
      reason: "GitHub 仓库已删除，或不在 App 的授权范围内。请检查仓库是否存在及安装授权。",
      action: "permissions"
    };
  }
  if (/DMCA takedown/i.test(item.lastError ?? "")) {
    return {
      reason: "GitHub 因 DMCA 下架通知限制了该仓库的访问，暂时无法同步。可在 GitHub 查看详情，或停止同步。",
      action: "github"
    };
  }
  if (/GitHub (?:git )?request failed \((401|403|404)\)/.test(item.lastError ?? "")) {
    return {
      reason: "GitHub 拒绝访问该仓库，请检查 App 的安装权限与仓库范围后重试。",
      action: "permissions"
    };
  }
  const translated = githubErrorMessage(item.lastError);
  return {
    reason: translated && translated !== item.lastError
      ? translated
      : "仓库同步失败，可重试同步；若仍然失败，请查看错误详情。",
    action: "retry"
  };
}
