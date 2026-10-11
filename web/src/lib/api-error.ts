import { githubErrorMessage } from "./github-errors";
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const messages: Record<string, string> = {
  "Invalid credentials": "用户名、邮箱或密码不正确，请重新输入。",
  "User registration is disabled": "当前未开放注册。",
  "Password must be at least 8 characters": "密码至少需要 8 位。",
  "Username or email already exists": "用户名或邮箱已被使用，请更换后重试。",
  "Repository already exists": "仓库名已被使用，请更换后重试。",
  "Repository not found": "仓库不存在或你没有访问权限。",
  "User not found": "用户不存在，请检查用户名。",
  "Token not found": "令牌不存在，请刷新列表。",
  "Commit not found": "提交不存在，请选择其他提交。",
  "Path not found": "路径不存在，请返回目录查看。",
  "Invalid path": "路径无效，请返回目录查看。",
  "Invalid email format": "邮箱格式不正确，请检查后重试。",
  "Owner is already a full-access member": "仓库所有者已拥有全部权限，无需添加。",
  "Cannot remove repository owner": "无法移除仓库所有者。"
};

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const githubMessage = githubErrorMessage(error.message);
    if (githubMessage !== error.message && githubMessage) return githubMessage;
    if (/[\u3400-\u9fff]/.test(error.message)) return error.message;
    if (messages[error.message]) return messages[error.message];
    if (error.message.startsWith("Invalid username"))
      return "用户名需为 1–32 位字母、数字或 ._-，首尾不能是标点。";
    if (error.message.startsWith("Invalid repository name"))
      return "仓库名需为 1–100 位字母、数字或 ._-，不能以 .git 结尾。";
    if (error.message.includes("sourceOid"))
      return "请选择仓库内的提交，或输入完整的 40 位提交 SHA。";
    if (error.message.includes("branchName")) return "分支名无效，请检查后重试。";
    if (error.status === 401) return "未登录或登录已过期，请重新登录。";
    if (error.status === 403) return "你没有执行此操作的权限。";
    if (error.status === 404) return "内容不存在，请刷新后重试。";
    if (error.status === 409) return "操作发生冲突，请刷新后重试。";
    if (error.status === 400) return "提交的信息无效，请检查后重试。";
    return "请求失败，请稍后重试。";
  }
  return "无法完成请求，请检查网络后重试。";
}

// GitHub forms retain server validation details, including future error reasons.
export function formatGithubApiError(error: unknown): string {
  return error instanceof ApiError
    ? (githubErrorMessage(error.message) ?? formatApiError(error))
    : formatApiError(error);
}
