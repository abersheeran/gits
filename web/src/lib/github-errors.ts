const messages: Record<string, string> = {
  "GitHub token is invalid or expired": "GitHub 令牌无效或已过期，请更换令牌。",
  "The token belongs to a different GitHub account":
    "令牌属于其他 GitHub 账号，请使用当前账号的令牌。",
  "GitHub synchronization is not configured": "请管理员先配置 GITHUB_TOKEN_ENCRYPTION_KEY。",
  "GitHub connection not found": "GitHub 账号连接不存在，请刷新后重试。",
  "GitHub sync source not found": "同步源不存在，请返回同步页面。",
  "This GitHub owner already has a sync source": "该 GitHub 所有者已启用同步。",
  "GitHub repository not found": "GitHub 仓库不存在，请刷新后重试。",
  "Invalid local repository name": "本地名称需为 1–100 个字母、数字、点、下划线或连字符。",
  "Invalid repository name prefix": "前缀只能包含字母、数字、点、下划线或连字符，最多 100 个字符。",
  "Invalid visibility policy": "请选择有效的可见性。",
  "Invalid discovery interval": "请选择有效的同步频率。",
  "Invalid repository status filter": "筛选条件无效，请重新选择。",
  "Invalid repository selection": "同步选择无效，请刷新后重试。",
  "Repository is not a mirror": "该仓库已停止同步，请刷新页面。",
  "Cannot decrypt GitHub token. Replace the saved token.":
    "无法使用已保存的 GitHub 令牌，请更换令牌。",
  "Cannot reach GitHub": "无法连接 GitHub，请稍后重试。",
  "Authorize this token for organization SAML SSO": "请在 GitHub 为此令牌授权组织的 SAML SSO。",
  "GitHub rate limit exceeded": "已达到 GitHub 请求频率限制，请稍后重试。",
  "GitHub owner or repository is not accessible": "无法访问 GitHub 所有者或仓库，请检查令牌权限。",
  "GitHub operation failed": "GitHub 操作失败，请稍后重试。",
  "Sync lease expired": "同步超时，请重新同步。",
  "Mirror task was cancelled or its lease expired": "同步已取消或超时，请重新同步。"
};
export function githubErrorMessage(message: string | null): string | null {
  if (!message) return null;
  if (messages[message]) return messages[message];
  const missingScopes = message.match(/^GitHub token is missing scopes: (.+)$/);
  if (missingScopes) return `GitHub 令牌缺少权限范围：${missingScopes[1]}。请更换令牌。`;
  const failedRequest = message.match(/^GitHub request failed \((\d+)\)$/);
  if (failedRequest) return `GitHub 请求失败（${failedRequest[1]}），请检查令牌权限后重试。`;
  return message;
}
