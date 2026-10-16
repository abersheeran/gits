import { Link } from "react-router-dom";
import type { AuthUser } from "@/lib/api";
import { CopyField } from "./copy-field";
import { CopyIconButton } from "./copy-icon-button";
import { Panel, PanelTitle } from "./panel";

export function EmptyRepositoryGuide({
  cloneUrl,
  defaultBranch,
  user
}: {
  cloneUrl: string;
  defaultBranch?: string | null;
  user: AuthUser | null;
}) {
  const commands = `git remote add origin ${cloneUrl}\ngit push -u origin ${defaultBranch || "main"}`;
  return (
    <Panel header={<PanelTitle>推送代码到此仓库</PanelTitle>}>
      <div className="space-y-4 p-4">
        <CopyField value={cloneUrl} label="Clone 地址" />
        <div className="space-y-2">
          <h3 className="text-body-xs font-medium">推送已有的本地仓库</h3>
          <div className="flex items-start gap-1 rounded-md bg-surface-canvas">
            <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-3 py-2.5 font-mono text-[13px]">
              {commands}
            </pre>
            <CopyIconButton
              value={commands}
              label="复制推送命令"
              className="mr-1 shrink-0 md:mt-1"
            />
          </div>
        </div>
        {user && (
          <p className="text-body-xs text-text-secondary">
            推送时用户名填写 {user.username}，密码填写
            <Link to="/tokens" className="gh-link">
              访问令牌
            </Link>
            。
          </p>
        )}
      </div>
    </Panel>
  );
}
