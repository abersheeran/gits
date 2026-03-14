import { Play, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InlineLoadingState } from "@/components/ui/loading-state";
import type { ActionWorkflowRecord } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type RepositoryActionsWorkflowsPanelProps = {
  workflows: ActionWorkflowRecord[];
  canManageActions: boolean;
  loading: boolean;
  savingWorkflowId: string | null;
  dispatchingWorkflowId: string | null;
  dispatchRef: string | null;
  onCreate: () => void;
  onEdit: (workflow: ActionWorkflowRecord) => void;
  onToggleEnabled: (workflow: ActionWorkflowRecord) => void;
  onDispatch: (workflow: ActionWorkflowRecord) => void;
};

const WORKFLOW_TRIGGER_LABELS: Record<ActionWorkflowRecord["trigger_event"], string> = {
  issue_created: "Issue 创建时",
  pull_request_created: "Pull Request 创建时",
  push: "代码推送时",
  mention_actions: "@actions mention"
};

function workflowPromptExcerpt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

export function RepositoryActionsWorkflowsPanel({
  workflows,
  canManageActions,
  loading,
  savingWorkflowId,
  dispatchingWorkflowId,
  dispatchRef,
  onCreate,
  onEdit,
  onToggleEnabled,
  onDispatch
}: RepositoryActionsWorkflowsPanelProps) {
  const enabledCount = workflows.filter((workflow) => workflow.enabled === 1).length;
  const automatedCount = workflows.length;

  return (
    <section className="page-panel">
      <div className="panel-content space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="font-display text-heading-3-16-semibold text-text-primary">
              工作流规则
            </h2>
            <p className="max-w-3xl text-body-sm text-text-secondary">
              管理哪些仓库事件会创建新的会话，并在需要时手动执行一次。
            </p>
          </div>
          {canManageActions ? (
            <Button onClick={onCreate}>
              <Plus className="size-4" />
              新建工作流
            </Button>
          ) : null}
        </div>

        {loading ? (
          <InlineLoadingState
            title="正在加载工作流"
            description="正在同步触发规则和手动执行配置。"
          />
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="panel-inset-compact space-y-1">
            <p className="text-label-xs text-text-supporting">总数</p>
            <p className="font-display text-card-title text-text-primary">{workflows.length}</p>
            <p className="text-body-xs text-text-secondary">当前对用户可见的工作流数量。</p>
          </div>
          <div className="panel-inset-compact space-y-1">
            <p className="text-label-xs text-text-supporting">启用中</p>
            <p className="font-display text-card-title text-text-primary">{enabledCount}</p>
            <p className="text-body-xs text-text-secondary">会继续参与触发匹配的规则。</p>
          </div>
          <div className="panel-inset-compact space-y-1">
            <p className="text-label-xs text-text-supporting">自动触发</p>
            <p className="font-display text-card-title text-text-primary">{automatedCount}</p>
            <p className="text-body-xs text-text-secondary">来自 issue、PR 或 push 的自动触发。</p>
          </div>
        </div>

        {workflows.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-border-subtle bg-surface-focus px-4 py-4 text-body-sm text-text-secondary">
            当前仓库还没有工作流。先定义触发规则，再让仓库事件自动创建会话。
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {workflows.map((workflow) => (
              <article key={workflow.id} className="panel-inset space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={workflow.enabled === 1 ? "default" : "outline"}>
                        {workflow.enabled === 1 ? "已启用" : "已停用"}
                      </Badge>
                      <Badge variant="outline">
                        {WORKFLOW_TRIGGER_LABELS[workflow.trigger_event]}
                      </Badge>
                      <Badge variant="outline">{workflow.agent_type}</Badge>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-body-sm font-medium text-text-primary">
                        {workflow.name}
                      </h3>
                      <p className="text-body-xs text-text-secondary">
                        更新于 {formatDateTime(workflow.updated_at)}
                      </p>
                    </div>
                  </div>

                  {canManageActions ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => onEdit(workflow)}>
                        <Settings2 className="size-4" />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={savingWorkflowId === workflow.id}
                        onClick={() => onToggleEnabled(workflow)}
                      >
                        {savingWorkflowId === workflow.id
                          ? "保存中..."
                          : workflow.enabled === 1
                            ? "停用"
                            : "启用"}
                      </Button>
                    </div>
                  ) : null}
                </div>

                <p className="text-body-sm text-text-secondary">
                  {workflowPromptExcerpt(workflow.prompt)}
                </p>

                <div className="flex flex-wrap gap-2">
                  {workflow.push_branch_regex ? (
                    <Badge variant="outline" className="font-mono text-code-sm">
                      branch {workflow.push_branch_regex}
                    </Badge>
                  ) : null}
                  {workflow.push_tag_regex ? (
                    <Badge variant="outline" className="font-mono text-code-sm">
                      tag {workflow.push_tag_regex}
                    </Badge>
                  ) : null}
                </div>

                {canManageActions ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
                    <p className="text-body-xs text-text-secondary">
                      手动执行会基于当前仓库 ref
                      {dispatchRef ? ` ${dispatchRef}` : " 创建一个新的会话"}。
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={dispatchingWorkflowId === workflow.id || workflow.enabled !== 1}
                      onClick={() => onDispatch(workflow)}
                    >
                      <Play className="size-4" />
                      {dispatchingWorkflowId === workflow.id ? "创建中..." : "立即执行"}
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
