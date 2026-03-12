import type { FormEvent } from "react";
import { HelpTip } from "@/components/common/help-tip";
import { LabeledSelectField } from "@/components/common/labeled-select-field";
import { CodeConfigPanel } from "@/components/repository/code-config-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import type { ActionContainerInstanceType, RepositoryActionsConfig } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS } from "@/lib/action-run-utils";

type RepositoryActionsConfigPanelProps = {
  loading: boolean;
  config: RepositoryActionsConfig | null;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  action: "save" | "reset" | null;
  instanceType: ActionContainerInstanceType;
  codexConfigFileContent: string;
  claudeCodeConfigFileContent: string;
  onInstanceTypeChange: (value: ActionContainerInstanceType) => void;
  onCodexConfigChange: (value: string) => void;
  onClaudeCodeConfigChange: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
};

const configEditorStyle = {
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
} as const;

export function RepositoryActionsConfigPanel({
  loading,
  config,
  editing,
  dirty,
  saving,
  action,
  instanceType,
  codexConfigFileContent,
  claudeCodeConfigFileContent,
  onInstanceTypeChange,
  onCodexConfigChange,
  onClaudeCodeConfigChange,
  onStartEditing,
  onCancelEditing,
  onSubmit,
  onReset
}: RepositoryActionsConfigPanelProps) {
  return (
    <section className="page-panel" id="actions-config-panel" role="tabpanel" aria-labelledby="actions-config-tab">
      <div className="panel-content space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-heading-3-16-semibold text-text-primary">
                Runtime config
              </h2>
              <HelpTip content="仓库级 runtime 覆盖配置会影响之后的新 session。查看态与编辑态都在同一空间切换。" />
            </div>
            <p className="max-w-3xl text-body-sm text-text-secondary">
              查看仓库级 container 规格，以及注入给 Codex / Claude Code 的配置文件覆盖。
            </p>
          </div>
          {config ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-border-subtle bg-surface-focus">
                {config.updated_at ? `updated ${formatDateTime(config.updated_at)}` : "not saved yet"}
              </Badge>
              {editing ? (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={onCancelEditing}>
                    Cancel
                  </Button>
                  <PendingButton
                    type="submit"
                    form="repository-actions-config-form"
                    size="sm"
                    pending={action === "save"}
                    disabled={!dirty || (saving && action !== "save")}
                    pendingText="Saving config..."
                  >
                    保存容器配置
                  </PendingButton>
                  <PendingButton
                    type="button"
                    size="sm"
                    variant="outline"
                    pending={action === "reset"}
                    disabled={saving && action !== "reset"}
                    pendingText="Resetting..."
                    onClick={onReset}
                  >
                    恢复全局默认
                  </PendingButton>
                </>
              ) : (
                <Button type="button" size="sm" onClick={onStartEditing}>
                  Edit config
                </Button>
              )}
            </div>
          ) : null}
        </div>

        {loading || !config ? (
          <InlineLoadingState
            title="Loading repository config"
            description="Fetching the inherited and overridden container settings."
          />
        ) : (
          <form
            id="repository-actions-config-form"
            className="space-y-5"
            onSubmit={onSubmit}
          >
            <section className="panel-inset space-y-4">
              <div className="space-y-1">
                <h3 className="text-body-sm font-medium text-text-primary">Instance type</h3>
                <p className="text-body-sm text-text-secondary">
                  这个设置决定 Cloudflare container 的 CPU、内存和磁盘规格。
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
                <LabeledSelectField<ActionContainerInstanceType>
                  id="repository-runner-instance-type"
                  label="实例规格"
                  value={instanceType}
                  onValueChange={onInstanceTypeChange}
                  options={ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label
                  }))}
                  triggerClassName="bg-surface-base"
                />

                <div className="overflow-x-auto rounded-[24px] border border-border-subtle bg-surface-base">
                  <table className="min-w-full text-left text-body-xs text-text-primary">
                    <thead className="bg-surface-focus">
                      <tr>
                        <th className="px-4 py-3 font-medium">Instance type</th>
                        <th className="px-4 py-3 font-medium">规格</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ACTION_CONTAINER_INSTANCE_TYPE_OPTIONS.map((option) => (
                        <tr
                          key={option.value}
                          className={
                            option.value === instanceType
                              ? "bg-surface-focus"
                              : "border-t border-border-subtle"
                          }
                        >
                          <td className="px-4 py-3 font-mono text-code-sm">{option.label}</td>
                          <td className="px-4 py-3 text-text-secondary">{option.spec}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <CodeConfigPanel
              title="Codex"
              description="映射到容器 `/home/rootless/.codex/config.toml`。"
              label="Codex 配置文件内容"
              value={codexConfigFileContent}
              editing={editing}
              onChange={onCodexConfigChange}
              style={configEditorStyle}
              statusText={
                config.inheritsGlobalCodexConfig ? "Inheriting global" : "Repository override"
              }
            />

            <CodeConfigPanel
              title="Claude Code"
              description="映射到容器 `/home/rootless/.claude/settings.json`。"
              label="Claude Code 配置文件内容"
              value={claudeCodeConfigFileContent}
              editing={editing}
              onChange={onClaudeCodeConfigChange}
              style={configEditorStyle}
              statusText={
                config.inheritsGlobalClaudeCodeConfig
                  ? "Inheriting global"
                  : "Repository override"
              }
            />
          </form>
        )}
      </div>
    </section>
  );
}
