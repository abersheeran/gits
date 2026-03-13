import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LabeledSelectField } from "@/components/common/labeled-select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { ActionAgentType, ActionWorkflowRecord, ActionWorkflowTrigger } from "@/lib/api";

type ConfigurableActionWorkflowTrigger = Exclude<ActionWorkflowTrigger, "mention_actions">;

type WorkflowSheetMode = "create" | "edit";

type RepositoryActionsWorkflowSheetProps = {
  open: boolean;
  mode: WorkflowSheetMode;
  workflow: ActionWorkflowRecord | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    name: string;
    triggerEvent: ConfigurableActionWorkflowTrigger;
    agentType: ActionAgentType;
    prompt: string;
    pushBranchRegex: string | null;
    pushTagRegex: string | null;
    enabled: boolean;
  }) => Promise<void>;
};

const WORKFLOW_TRIGGER_OPTIONS: Array<{
  value: ConfigurableActionWorkflowTrigger;
  label: string;
}> = [
  { value: "issue_created", label: "Issue 创建时" },
  { value: "pull_request_created", label: "Pull Request 创建时" },
  { value: "push", label: "代码推送时" }
];

const AGENT_TYPE_OPTIONS: Array<{
  value: ActionAgentType;
  label: string;
}> = [
  { value: "codex", label: "Codex" },
  { value: "claude_code", label: "Claude Code" }
];

const ENABLED_OPTIONS = [
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "停用" }
] as const;

function normalizedText(value: string): string {
  return value.trim();
}

export function RepositoryActionsWorkflowSheet({
  open,
  mode,
  workflow,
  saving,
  onOpenChange,
  onSubmit
}: RepositoryActionsWorkflowSheetProps) {
  const [name, setName] = useState("");
  const [triggerEvent, setTriggerEvent] = useState<ConfigurableActionWorkflowTrigger>("issue_created");
  const [agentType, setAgentType] = useState<ActionAgentType>("codex");
  const [prompt, setPrompt] = useState("");
  const [pushBranchRegex, setPushBranchRegex] = useState("");
  const [pushTagRegex, setPushTagRegex] = useState("");
  const [enabledState, setEnabledState] = useState<(typeof ENABLED_OPTIONS)[number]["value"]>(
    "enabled"
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(workflow?.name ?? "");
    setTriggerEvent(
      workflow && workflow.trigger_event !== "mention_actions"
        ? workflow.trigger_event
        : "issue_created"
    );
    setAgentType(workflow?.agent_type ?? "codex");
    setPrompt(workflow?.prompt ?? "");
    setPushBranchRegex(workflow?.push_branch_regex ?? "");
    setPushTagRegex(workflow?.push_tag_regex ?? "");
    setEnabledState(workflow?.enabled === 0 ? "disabled" : "enabled");
  }, [open, workflow]);

  const isPushWorkflow = triggerEvent === "push";
  const title = mode === "create" ? "创建 workflow" : "编辑 workflow";
  const description =
    mode === "create"
      ? "定义新的触发规则，让平台在合适的时机创建 session。"
      : "直接修改当前 workflow 的触发条件、Agent 和 prompt。";
  const canSubmit = useMemo(() => {
    return normalizedText(name).length > 0 && normalizedText(prompt).length > 0;
  }, [name, prompt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || saving) {
      return;
    }
    await onSubmit({
      name: normalizedText(name),
      triggerEvent,
      agentType,
      prompt: normalizedText(prompt),
      pushBranchRegex: isPushWorkflow ? normalizedText(pushBranchRegex) || null : null,
      pushTagRegex: isPushWorkflow ? normalizedText(pushTagRegex) || null : null,
      enabled: enabledState === "enabled"
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-[720px] border-l border-border-subtle bg-surface-base px-6 py-6 sm:px-8"
      >
        <form className="flex h-full flex-col gap-6" onSubmit={handleSubmit}>
          <SheetHeader className="pr-12">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>

          <div className="grid gap-4 overflow-y-auto pr-1">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-label-sm text-text-primary" htmlFor="actions-workflow-name">
                  Workflow 名称
                </label>
                <Input
                  id="actions-workflow-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：PR review follow-up"
                  className="bg-surface-base"
                />
              </div>

              <LabeledSelectField
                id="actions-workflow-enabled"
                label="当前状态"
                value={enabledState}
                onValueChange={setEnabledState}
                options={ENABLED_OPTIONS}
                triggerClassName="bg-surface-base"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <LabeledSelectField
                id="actions-workflow-trigger"
                label="触发方式"
                value={triggerEvent}
                onValueChange={setTriggerEvent}
                options={WORKFLOW_TRIGGER_OPTIONS}
                triggerClassName="bg-surface-base"
              />

              <LabeledSelectField
                id="actions-workflow-agent"
                label="执行 Agent"
                value={agentType}
                onValueChange={setAgentType}
                options={AGENT_TYPE_OPTIONS}
                triggerClassName="bg-surface-base"
              />
            </div>

            {isPushWorkflow ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="text-label-sm text-text-primary"
                    htmlFor="actions-workflow-push-branch-regex"
                  >
                    分支匹配正则
                  </label>
                  <Input
                    id="actions-workflow-push-branch-regex"
                    value={pushBranchRegex}
                    onChange={(event) => setPushBranchRegex(event.target.value)}
                    placeholder="例如：^main$"
                    className="bg-surface-base font-mono text-code-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    className="text-label-sm text-text-primary"
                    htmlFor="actions-workflow-push-tag-regex"
                  >
                    标签匹配正则
                  </label>
                  <Input
                    id="actions-workflow-push-tag-regex"
                    value={pushTagRegex}
                    onChange={(event) => setPushTagRegex(event.target.value)}
                    placeholder="例如：^v\\d+\\.\\d+\\.\\d+$"
                    className="bg-surface-base font-mono text-code-sm"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-label-sm text-text-primary" htmlFor="actions-workflow-prompt">
                执行 prompt
              </label>
              <Textarea
                id="actions-workflow-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={12}
                placeholder="直接写清楚本次 session 应完成的任务、范围和交付方式。"
                className="min-h-[280px] bg-surface-base"
              />
              <p className="text-body-xs text-text-secondary">
                面向任务与结果描述，不写布局说明、内部实现状态或数据来源自述。
              </p>
            </div>
          </div>

          <SheetFooter className="border-t border-border-subtle pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || saving}>
              {saving ? "保存中..." : mode === "create" ? "创建 workflow" : "保存 workflow"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
