import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { CodeConfigPanel } from "@/components/repository/code-config-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import {
  formatApiError,
  getActionsGlobalConfig,
  updateActionsGlobalConfig,
  type ActionsGlobalConfig,
  type AuthUser
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type ActionsSettingsPageProps = {
  user: AuthUser | null;
};

export function ActionsSettingsPage({ user }: ActionsSettingsPageProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [config, setConfig] = useState<ActionsGlobalConfig | null>(null);
  const [codexConfigFileContent, setCodexConfigFileContent] = useState("");

  const [claudeCodeConfigFileContent, setClaudeCodeConfigFileContent] = useState("");

  useEffect(() => {
    let canceled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextConfig = await getActionsGlobalConfig();
        if (canceled) {
          return;
        }
        setConfig(nextConfig);
        setCodexConfigFileContent(nextConfig.codexConfigFileContent);
        setClaudeCodeConfigFileContent(nextConfig.claudeCodeConfigFileContent);
      } catch (loadError) {
        if (!canceled) {
          setError(formatApiError(loadError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, []);

  function resetDraft(nextConfig: ActionsGlobalConfig) {
    setCodexConfigFileContent(nextConfig.codexConfigFileContent);
    setClaudeCodeConfigFileContent(nextConfig.claudeCodeConfigFileContent);
  }

  function handleStartEditing() {
    setEditing(true);
    setError(null);
  }

  function handleCancelEditing() {
    if (config) {
      resetDraft(config);
    }
    setEditing(false);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: {
        codexConfigFileContent?: string | null;
        claudeCodeConfigFileContent?: string | null;
      } = {
        codexConfigFileContent,
        claudeCodeConfigFileContent
      };

      const nextConfig = await updateActionsGlobalConfig(payload);
      setConfig(nextConfig);
      resetDraft(nextConfig);
      setEditing(false);
      setSuccess("配置已更新。新的 Actions run 会使用最新设置。");
    } catch (saveError) {
      setError(formatApiError(saveError));
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (error && !config) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !config) {
    return (
      <PageLoadingState
        title="Loading actions config"
        description="Fetching the current global defaults for Codex and Claude Code."
      />
    );
  }

  const configEditorStyle = {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
  } as const;
  const hasConfigChanges =
    codexConfigFileContent !== config.codexConfigFileContent ||
    claudeCodeConfigFileContent !== config.claudeCodeConfigFileContent;

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>保存失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert>
          <AlertTitle>已保存</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="border-b border-border-subtle bg-surface-focus">
          <CardTitle>Actions 全局默认配置</CardTitle>
          <CardDescription>
            这里编辑的是全局默认值。仓库 Actions 页面可以在此基础上保存自己的覆盖配置。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-3 rounded-[24px] border border-border-subtle bg-surface-focus p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-label-xs text-text-supporting">
                Global defaults
              </p>
              <p className="mt-1 text-body-sm text-text-secondary">
                updated: {formatDateTime(config.updated_at)}
              </p>
            </div>
            {editing ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleCancelEditing}>
                  Cancel
                </Button>
                <PendingButton
                  type="submit"
                  form="actions-global-config-form"
                  pending={saving}
                  disabled={!hasConfigChanges}
                  pendingText="Saving config..."
                >
                  保存配置
                </PendingButton>
              </div>
            ) : (
              <Button onClick={handleStartEditing}>
                Edit config
              </Button>
            )}
          </div>

          <form id="actions-global-config-form" className="space-y-6" onSubmit={handleSubmit}>
            <CodeConfigPanel
              title="Codex"
              description="映射到容器 `/home/rootless/.codex/config.toml`。"
              label="Codex 配置文件内容"
              value={codexConfigFileContent}
              editing={editing}
              onChange={setCodexConfigFileContent}
              style={configEditorStyle}
            />

            <CodeConfigPanel
              title="Claude Code"
              description="映射到容器 `/home/rootless/.claude/settings.json`。"
              label="Claude Code 配置文件内容"
              value={claudeCodeConfigFileContent}
              editing={editing}
              onChange={setClaudeCodeConfigFileContent}
              style={configEditorStyle}
            />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link to="/dashboard">返回 Dashboard</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
