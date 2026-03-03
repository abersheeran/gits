import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Code2, GitPullRequest, MessageSquareText, Play, Workflow } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createActionWorkflow,
  dispatchActionWorkflow,
  formatApiError,
  getActionRun,
  getRepositoryDetail,
  listActionRuns,
  listActionWorkflows,
  rerunActionRun,
  updateActionWorkflow,
  type ActionRunRecord,
  type ActionAgentType,
  type ActionWorkflowRecord,
  type ActionWorkflowTrigger,
  type AuthUser,
  type RepositoryDetailResponse
} from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

type RepositoryActionsPageProps = {
  user: AuthUser | null;
};

function statusBadgeVariant(status: ActionRunRecord["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") {
    return "default";
  }
  if (status === "failed" || status === "cancelled") {
    return "destructive";
  }
  if (status === "running") {
    return "secondary";
  }
  return "outline";
}

export function RepositoryActionsPage({ user }: RepositoryActionsPageProps) {
  const params = useParams<{ owner: string; repo: string }>();
  const [searchParams] = useSearchParams();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";
  const selectedRunId = searchParams.get("runId")?.trim() || null;

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [workflows, setWorkflows] = useState<ActionWorkflowRecord[]>([]);
  const [runs, setRuns] = useState<ActionRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creatingWorkflow, setCreatingWorkflow] = useState(false);
  const [dispatchingWorkflowId, setDispatchingWorkflowId] = useState<string | null>(null);
  const [rerunningRunId, setRerunningRunId] = useState<string | null>(null);
  const [expandedRunIds, setExpandedRunIds] = useState<string[]>([]);

  const [workflowName, setWorkflowName] = useState("");
  const [workflowTriggerEvent, setWorkflowTriggerEvent] = useState<ActionWorkflowTrigger>(
    "pull_request_created"
  );
  const [workflowAgentType, setWorkflowAgentType] = useState<ActionAgentType>("codex");
  const [workflowPrompt, setWorkflowPrompt] = useState(
    "请完整检查这个仓库并运行测试，修复失败并提交变更。"
  );
  const [workflowPushBranchRegex, setWorkflowPushBranchRegex] = useState("");
  const [workflowPushTagRegex, setWorkflowPushTagRegex] = useState("");
  const [workflowEnabled, setWorkflowEnabled] = useState(true);

  const canManageActions = Boolean(user) && Boolean(detail?.permissions.canCreateIssueOrPullRequest);

  async function loadData() {
    if (!owner || !repo) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextDetail, nextWorkflows, nextRuns] = await Promise.all([
        getRepositoryDetail(owner, repo),
        listActionWorkflows(owner, repo),
        listActionRuns(owner, repo, { limit: 50 })
      ]);
      let mergedRuns = nextRuns;
      if (selectedRunId && !nextRuns.some((run) => run.id === selectedRunId)) {
        try {
          const selectedRun = await getActionRun(owner, repo, selectedRunId);
          mergedRuns = [selectedRun, ...nextRuns]
            .filter((run, index, array) => array.findIndex((item) => item.id === run.id) === index)
            .sort((left, right) => right.run_number - left.run_number);
        } catch {
          // Ignore missing run and keep default list.
        }
      }
      setDetail(nextDetail);
      setWorkflows(nextWorkflows);
      setRuns(mergedRuns);
    } catch (loadError) {
      setError(formatApiError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [owner, repo, selectedRunId]);

  const hasPendingRuns = useMemo(
    () => runs.some((run) => run.status === "queued" || run.status === "running"),
    [runs]
  );

  useEffect(() => {
    if (!hasPendingRuns) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadData();
    }, 3500);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingRuns, owner, repo]);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    setExpandedRunIds((current) =>
      current.includes(selectedRunId) ? current : [...current, selectedRunId]
    );
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`action-run-${selectedRunId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedRunId, runs.length]);

  async function handleCreateWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageActions || creatingWorkflow) {
      return;
    }

    setCreatingWorkflow(true);
    setError(null);
    try {
      await createActionWorkflow(owner, repo, {
        name: workflowName,
        triggerEvent: workflowTriggerEvent,
        agentType: workflowAgentType,
        prompt: workflowPrompt,
        pushBranchRegex:
          workflowTriggerEvent === "push"
            ? (workflowPushBranchRegex.trim() || null)
            : null,
        pushTagRegex:
          workflowTriggerEvent === "push" ? (workflowPushTagRegex.trim() || null) : null,
        enabled: workflowEnabled
      });
      setWorkflowName("");
      setWorkflowAgentType("codex");
      setWorkflowPrompt("请完整检查这个仓库并运行测试，修复失败并提交变更。");
      setWorkflowTriggerEvent("pull_request_created");
      setWorkflowPushBranchRegex("");
      setWorkflowPushTagRegex("");
      setWorkflowEnabled(true);
      await loadData();
    } catch (createError) {
      setError(formatApiError(createError));
    } finally {
      setCreatingWorkflow(false);
    }
  }

  async function handleToggleWorkflow(workflow: ActionWorkflowRecord) {
    if (!canManageActions) {
      return;
    }

    setError(null);
    try {
      await updateActionWorkflow(owner, repo, workflow.id, {
        enabled: workflow.enabled !== 1
      });
      await loadData();
    } catch (toggleError) {
      setError(formatApiError(toggleError));
    }
  }

  async function handleDispatchWorkflow(workflow: ActionWorkflowRecord) {
    if (!canManageActions || dispatchingWorkflowId) {
      return;
    }

    setDispatchingWorkflowId(workflow.id);
    setError(null);
    try {
      await dispatchActionWorkflow(owner, repo, workflow.id);
      await loadData();
    } catch (dispatchError) {
      setError(formatApiError(dispatchError));
    } finally {
      setDispatchingWorkflowId(null);
    }
  }

  async function handleRerunRun(run: ActionRunRecord) {
    if (!canManageActions || rerunningRunId || dispatchingWorkflowId) {
      return;
    }

    setRerunningRunId(run.id);
    setError(null);
    try {
      await rerunActionRun(owner, repo, run.id);
      await loadData();
    } catch (rerunError) {
      setError(formatApiError(rerunError));
    } finally {
      setRerunningRunId(null);
    }
  }

  function toggleRunLogs(runId: string) {
    setExpandedRunIds((current) =>
      current.includes(runId) ? current.filter((item) => item !== runId) : [...current, runId]
    );
  }

  if (!owner || !repo) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>仓库路径不完整。</AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !detail) {
    return <p className="text-sm text-muted-foreground">正在加载 Actions...</p>;
  }

  return (
    <div className="space-y-4">
      <header className="space-y-3 rounded-md border bg-card p-4 shadow-sm">
        <h1 className="text-xl font-semibold">
          <Link className="gh-link" to={`/repo/${owner}/${repo}`}>
            {owner}/{repo}
          </Link>{" "}
          <span className="text-muted-foreground">/ Actions</span>
        </h1>
        <nav className="flex flex-wrap items-end gap-1 border-b border-border px-1" aria-label="Repository sections">
          <Link
            to={`/repo/${owner}/${repo}`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          >
            <Code2 className="h-4 w-4" />
            Code
          </Link>
          <Link
            to={`/repo/${owner}/${repo}/issues`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          >
            <MessageSquareText className="h-4 w-4" />
            Issues
            <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">{detail.openIssueCount}</span>
          </Link>
          <Link
            to={`/repo/${owner}/${repo}/pulls`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:border-border hover:text-foreground"
          >
            <GitPullRequest className="h-4 w-4" />
            Pull requests
            <span className="rounded-full border bg-muted/30 px-1.5 text-[11px]">
              {detail.openPullRequestCount}
            </span>
          </Link>
          <Link
            to={`/repo/${owner}/${repo}/actions`}
            className="inline-flex items-center gap-1.5 rounded-t-md border-b-2 border-[#fd8c73] px-3 py-2 text-sm font-medium text-foreground"
          >
            <Workflow className="h-4 w-4" />
            Actions
          </Link>
        </nav>
      </header>

      {canManageActions ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create workflow</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateWorkflow}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="workflow-name">Name</Label>
                  <Input
                    id="workflow-name"
                    value={workflowName}
                    onChange={(event) => setWorkflowName(event.target.value)}
                    placeholder="CI"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workflow-agent">Agent</Label>
                  <Select
                    value={workflowAgentType}
                    onValueChange={(value) => setWorkflowAgentType(value as ActionAgentType)}
                  >
                    <SelectTrigger id="workflow-agent">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codex">codex</SelectItem>
                      <SelectItem value="claude_code">claude_code</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workflow-event">Trigger event</Label>
                  <Select
                    value={workflowTriggerEvent}
                    onValueChange={(value) => setWorkflowTriggerEvent(value as ActionWorkflowTrigger)}
                  >
                    <SelectTrigger id="workflow-event">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pull_request_created">pull_request_created</SelectItem>
                      <SelectItem value="push">push</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    `issue_created` is built-in and runs automatically.
                  </p>
                </div>
              </div>
              {workflowTriggerEvent === "push" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="workflow-push-branch-regex">Branch Regex（可选）</Label>
                    <Input
                      id="workflow-push-branch-regex"
                      value={workflowPushBranchRegex}
                      onChange={(event) => setWorkflowPushBranchRegex(event.target.value)}
                      placeholder="^main$|^release/.*$"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workflow-push-tag-regex">Tag Regex（可选）</Label>
                    <Input
                      id="workflow-push-tag-regex"
                      value={workflowPushTagRegex}
                      onChange={(event) => setWorkflowPushTagRegex(event.target.value)}
                      placeholder="^v\\d+\\.\\d+\\.\\d+$"
                    />
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="workflow-prompt">Agent Prompt</Label>
                <Textarea
                  id="workflow-prompt"
                  value={workflowPrompt}
                  onChange={(event) => setWorkflowPrompt(event.target.value)}
                  placeholder="让 agent 在容器里执行的任务描述"
                  rows={6}
                  required
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={workflowEnabled}
                  onCheckedChange={(checked) => setWorkflowEnabled(Boolean(checked))}
                />
                Enabled
              </label>
              <div>
                <Button type="submit" disabled={creatingWorkflow}>
                  {creatingWorkflow ? "Creating..." : "Create workflow"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          {workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workflows yet.</p>
          ) : (
            <ul className="space-y-2">
              {workflows.map((workflow) => (
                <li key={workflow.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{workflow.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {workflow.trigger_event} · updated {formatRelativeTime(workflow.updated_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{workflow.agent_type}</Badge>
                      <Badge variant={workflow.enabled === 1 ? "default" : "outline"}>
                        {workflow.enabled === 1 ? "enabled" : "disabled"}
                      </Badge>
                      {canManageActions ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void handleToggleWorkflow(workflow);
                          }}
                        >
                          {workflow.enabled === 1 ? "Disable" : "Enable"}
                        </Button>
                      ) : null}
                      {canManageActions ? (
                        <Button
                          size="sm"
                          disabled={dispatchingWorkflowId !== null || workflow.enabled !== 1}
                          onClick={() => {
                            void handleDispatchWorkflow(workflow);
                          }}
                        >
                          <Play className="mr-1 h-3.5 w-3.5" />
                          Run
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {workflow.trigger_event === "push" ? (
                    <p className="text-xs text-muted-foreground">
                      branch regex: {workflow.push_branch_regex ?? "(all)"} · tag regex:{" "}
                      {workflow.push_tag_regex ?? "(all)"}
                    </p>
                  ) : null}
                  <pre className="overflow-x-auto rounded-md bg-muted/30 p-2 text-xs">{workflow.prompt}</pre>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => {
                const expanded = expandedRunIds.includes(run.id);
                return (
                  <li
                    id={`action-run-${run.id}`}
                    key={run.id}
                    className={`space-y-2 rounded-md border p-3 ${
                      selectedRunId === run.id ? "border-[#fd8c73] bg-muted/20" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          #{run.run_number} {run.workflow_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {run.trigger_event}
                          {run.trigger_ref ? ` · ${run.trigger_ref}` : ""} · {formatDateTime(run.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                        <Badge variant="outline">{run.agent_type}</Badge>
                        <Badge variant="outline">
                          exit: {run.exit_code === null ? "-" : String(run.exit_code)}
                        </Badge>
                        {canManageActions ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rerunningRunId !== null || dispatchingWorkflowId !== null}
                            onClick={() => {
                              void handleRerunRun(run);
                            }}
                          >
                            {rerunningRunId === run.id ? "Rerunning..." : "Rerun"}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => toggleRunLogs(run.id)}>
                          {expanded ? "Hide logs" : "View logs"}
                        </Button>
                      </div>
                    </div>
                    {expanded ? (
                      <pre className="max-h-80 overflow-auto rounded-md bg-muted/30 p-2 text-xs">{run.logs || "(empty logs)"}</pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
