const errors: Record<string, string> = {
  state: "授权已过期或无效，请重新关联。",
  denied: "你取消了 GitHub 授权。",
  github: "GitHub 授权失败，请稍后重试。",
  not_configured: "尚未配置 GitHub App。",
  pending_approval: "安装请求已发送，组织管理员批准后，再点「关联已有安装」。"
};

export function readGithubCallback(search: string) {
  const params = new URLSearchParams(search);
  const present = ["error", "skipped", "bound"].some((key) => params.has(key));
  const messages: string[] = [];
  const error = params.get("error");
  if (error !== null) messages.push(errors[error] ?? errors.github);
  for (const skipped of params.getAll("skipped")) {
    const [login, reason] = skipped.split(":");
    if (!login) continue;
    switch (reason) {
      case "not_owner":
        messages.push(`「${login}」是其他 GitHub 用户的个人账号，只能由本人关联。`);
        break;
      case "not_admin":
        messages.push(`你不是组织「${login}」的管理员，需由组织管理员关联。`);
        break;
      case "taken":
        messages.push(`「${login}」已被其他 gits 用户关联。`);
        break;
      default:
        messages.push(`无法关联「${login}」，请重新关联。`);
    }
  }
  for (const key of ["error", "skipped", "bound"]) params.delete(key);
  return { present, messages, search: params.toString() };
}
