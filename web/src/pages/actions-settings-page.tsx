import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
      setCodexConfigFileContent(nextConfig.codexConfigFileContent);
      setClaudeCodeConfigFileContent(nextConfig.claudeCodeConfigFileContent);
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

  if (loading || !config) {
    return <p className="text-sm text-muted-foreground">正在加载 Actions 全局配置...</p>;
  }

  const configEditorStyle = {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
  } as const;

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
        <CardHeader>
          <CardTitle>Actions 全局配置</CardTitle>
          <CardDescription>
            这里直接编辑并保存 Codex / Claude Code 的配置文件内容。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-xs text-muted-foreground">updated: {formatDateTime(config.updated_at)}</p>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <section className="space-y-4 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Codex</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="codex-config-file-content">
                    配置文件内容（映射到容器 `/home/rootless/.codex/config.toml`）
                  </Label>
                  <Textarea
                    id="codex-config-file-content"
                    value={codexConfigFileContent}
                    onChange={(event) => setCodexConfigFileContent(event.target.value)}
                    rows={10}
                    wrap="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    className="font-mono text-xs leading-5 whitespace-pre overflow-x-auto"
                    style={configEditorStyle}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-md border p-4">
              <h2 className="text-sm font-semibold">Claude Code</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="claude-code-config-file-content">
                    配置文件内容（映射到容器 `/home/rootless/.claude/settings.json`）
                  </Label>
                  <Textarea
                    id="claude-code-config-file-content"
                    value={claudeCodeConfigFileContent}
                    onChange={(event) => setClaudeCodeConfigFileContent(event.target.value)}
                    rows={10}
                    wrap="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    className="font-mono text-xs leading-5 whitespace-pre overflow-x-auto"
                    style={configEditorStyle}
                  />
                </div>
              </div>
            </section>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "保存中..." : "保存配置"}
              </Button>
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
