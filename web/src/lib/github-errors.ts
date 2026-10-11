const messages: Record<string, string> = {
  "GitHub synchronization is not configured":
    "请部署者先运行 npm run github-app:create 注册 GitHub App。",
  "GitHub App is not configured": "尚未配置 GitHub App。",
  "GitHub sync source not found": "同步源不存在，请返回同步页面。",
  "GitHub installation is suspended": "GitHub App 安装已挂起，请在 GitHub 上恢复安装。",
  "GitHub repository not found": "GitHub 仓库不存在，请刷新后重试。",
  "Invalid local repository name": "本地名称需为 1–100 个字母、数字、点、下划线或连字符。",
  "Invalid repository name prefix": "前缀只能包含字母、数字、点、下划线或连字符，最多 100 个字符。",
  "Invalid visibility policy": "请选择有效的可见性。",
  "Invalid repository status filter": "筛选条件无效，请重新选择。",
  "Invalid repository selection": "同步选择无效，请刷新后重试。",
  "Repository is not a mirror": "该仓库已停止同步，请刷新页面。",
  "Cannot reach GitHub": "无法连接 GitHub，请稍后重试。",
  "GitHub rate limit exceeded": "已达到 GitHub 请求频率限制，请稍后重试。",
  "GitHub owner or repository is not accessible":
    "无法访问 GitHub 账号或仓库，请检查 App 的安装权限与仓库范围。",
  "GitHub operation failed": "GitHub 操作失败，请稍后重试。",
  "Sync lease expired": "同步超时，请重新同步。",
  "Mirror task was cancelled or its lease expired": "同步已取消或超时，请重新同步。"
};
export function githubErrorMessage(message: string | null): string | null {
  if (!message) return null;
  if (messages[message]) return messages[message];
  const failedRequest = message.match(/^GitHub request failed \((\d+)\)$/);
  if (failedRequest) return `GitHub 请求失败（${failedRequest[1]}），请检查 App 安装权限后重试。`;
  return message;
}
