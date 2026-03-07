import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CopyButton } from "@/components/copy-button";
import { RepositoryLabelChip } from "@/components/repository/repository-label-chip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createRepositoryLabel,
  createRepositoryMilestone,
  deleteRepositoryLabel,
  deleteRepositoryMilestone,
  deleteRepository,
  formatApiError,
  getRepositoryDetail,
  listRepositoryLabels,
  listRepositoryMilestones,
  updateRepositoryLabel,
  updateRepositoryMilestone,
  updateRepository,
  type AuthUser,
  type RepositoryLabelRecord,
  type RepositoryMilestoneRecord,
  type RepositoryDetailResponse
} from "@/lib/api";

type RepositorySettingsPageProps = {
  user: AuthUser | null;
};

function formatDateInput(timestamp: number | null): string {
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseDateInput(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function RepositorySettingsPage({ user }: RepositorySettingsPageProps) {
  const navigate = useNavigate();
  const params = useParams<{ owner: string; repo: string }>();
  const owner = params.owner ?? "";
  const repo = params.repo ?? "";

  const [detail, setDetail] = useState<RepositoryDetailResponse | null>(null);
  const [labels, setLabels] = useState<RepositoryLabelRecord[]>([]);
  const [milestones, setMilestones] = useState<RepositoryMilestoneRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [savePending, setSavePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [confirmRepoName, setConfirmRepoName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [labelSavingId, setLabelSavingId] = useState<string | null>(null);
  const [labelDeletingId, setLabelDeletingId] = useState<string | null>(null);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#0969da");
  const [newLabelDescription, setNewLabelDescription] = useState("");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [milestoneSavingId, setMilestoneSavingId] = useState<string | null>(null);
  const [milestoneDeletingId, setMilestoneDeletingId] = useState<string | null>(null);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState("");
  const [newMilestoneDescription, setNewMilestoneDescription] = useState("");
  const [newMilestoneDueAt, setNewMilestoneDueAt] = useState("");
  const [creatingMilestone, setCreatingMilestone] = useState(false);

  useEffect(() => {
    let canceled = false;

    async function load() {
      if (!owner || !repo) {
        return;
      }

      setLoading(true);
      setPageError(null);
      try {
        const [data, nextLabels, nextMilestones] = await Promise.all([
          getRepositoryDetail(owner, repo),
          listRepositoryLabels(owner, repo),
          listRepositoryMilestones(owner, repo)
        ]);
        if (canceled) {
          return;
        }
        setDetail(data);
        setLabels(nextLabels);
        setMilestones(nextMilestones);
        setName(data.repository.name);
        setDescription(data.repository.description ?? "");
        setIsPrivate(data.repository.is_private === 1);
      } catch (loadError) {
        if (!canceled) {
          setPageError(formatApiError(loadError));
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
  }, [owner, repo]);

  const cloneUrl = useMemo(() => `${window.location.origin}/${owner}/${repo}.git`, [owner, repo]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!owner || !repo) {
    return (
      <Alert variant="destructive">
        <AlertTitle>参数错误</AlertTitle>
        <AlertDescription>仓库路径不完整。</AlertDescription>
      </Alert>
    );
  }

  if (pageError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>加载失败</AlertTitle>
        <AlertDescription>{pageError}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !detail) {
    return <p className="text-sm text-muted-foreground">正在加载设置...</p>;
  }

  if (detail.repository.owner_username !== user.username) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无权限</AlertTitle>
        <AlertDescription>只有仓库 owner 可修改设置。</AlertDescription>
      </Alert>
    );
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending) {
      return;
    }

    setSavePending(true);
    setFormError(null);
    setNotice(null);
    try {
      await updateRepository(owner, repo, {
        name,
        description: description.trim() ? description : null,
        isPrivate
      });
      setNotice("仓库设置已更新");
      if (name !== repo) {
        navigate(`/repo/${owner}/${name}/settings`, { replace: true });
      } else {
        const reloaded = await getRepositoryDetail(owner, repo);
        setDetail(reloaded);
      }
    } catch (submitError) {
      setFormError(formatApiError(submitError));
    } finally {
      setSavePending(false);
    }
  }

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deletePending) {
      return;
    }
    if (confirmRepoName !== repo) {
      setFormError("确认名不匹配，未删除。");
      return;
    }

    setDeletePending(true);
    setFormError(null);
    try {
      await deleteRepository(owner, repo);
      navigate("/dashboard", { replace: true });
    } catch (deleteError) {
      setFormError(formatApiError(deleteError));
    } finally {
      setDeletePending(false);
    }
  }

  async function handleLabelSave(label: RepositoryLabelRecord) {
    setLabelSavingId(label.id);
    setFormError(null);
    setNotice(null);
    try {
      const updated = await updateRepositoryLabel(owner, repo, label.id, {
        name: label.name,
        color: label.color,
        description: label.description
      });
      setLabels((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`标签 ${updated.name} 已更新`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setLabelSavingId(null);
    }
  }

  async function handleLabelDelete(labelId: string) {
    setLabelDeletingId(labelId);
    setFormError(null);
    setNotice(null);
    try {
      await deleteRepositoryLabel(owner, repo, labelId);
      setLabels((previous) => previous.filter((label) => label.id !== labelId));
      setNotice("标签已删除");
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setLabelDeletingId(null);
    }
  }

  async function handleCreateLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingLabel) {
      return;
    }
    setCreatingLabel(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await createRepositoryLabel(owner, repo, {
        name: newLabelName,
        color: newLabelColor,
        description: newLabelDescription.trim() ? newLabelDescription : null
      });
      setLabels((previous) => [...previous, created].sort((left, right) => left.name.localeCompare(right.name)));
      setNewLabelName("");
      setNewLabelColor("#0969da");
      setNewLabelDescription("");
      setNotice(`标签 ${created.name} 已创建`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setCreatingLabel(false);
    }
  }

  async function handleMilestoneSave(milestone: RepositoryMilestoneRecord) {
    setMilestoneSavingId(milestone.id);
    setFormError(null);
    setNotice(null);
    try {
      const updated = await updateRepositoryMilestone(owner, repo, milestone.id, {
        title: milestone.title,
        description: milestone.description,
        dueAt: milestone.due_at,
        state: milestone.state
      });
      setMilestones((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item))
      );
      setNotice(`里程碑 ${updated.title} 已更新`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setMilestoneSavingId(null);
    }
  }

  async function handleMilestoneDelete(milestoneId: string) {
    setMilestoneDeletingId(milestoneId);
    setFormError(null);
    setNotice(null);
    try {
      await deleteRepositoryMilestone(owner, repo, milestoneId);
      setMilestones((previous) => previous.filter((milestone) => milestone.id !== milestoneId));
      setNotice("里程碑已删除");
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setMilestoneDeletingId(null);
    }
  }

  async function handleCreateMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingMilestone) {
      return;
    }
    setCreatingMilestone(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await createRepositoryMilestone(owner, repo, {
        title: newMilestoneTitle,
        description: newMilestoneDescription,
        dueAt: parseDateInput(newMilestoneDueAt)
      });
      setMilestones((previous) => [created, ...previous]);
      setNewMilestoneTitle("");
      setNewMilestoneDescription("");
      setNewMilestoneDueAt("");
      setNotice(`里程碑 ${created.title} 已创建`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setCreatingMilestone(false);
    }
  }

  return (
    <div className="space-y-6">
      {notice ? (
        <Alert>
          <AlertTitle>保存成功</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            仓库设置: {owner}/{repo}
          </CardTitle>
          <CardDescription>更新仓库名、描述和可见性。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>当前 clone URL</Label>
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
              <code className="text-xs sm:text-sm">{cloneUrl}</code>
              <CopyButton value={cloneUrl} />
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSave}>
            <div className="space-y-2">
              <Label htmlFor="repo-name">仓库名</Label>
              <Input id="repo-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-description">描述</Label>
              <Input
                id="repo-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="repo-private"
                checked={isPrivate}
                onCheckedChange={(checked) => setIsPrivate(checked === true)}
              />
              <Label htmlFor="repo-private">私有仓库</Label>
            </div>

            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={savePending}>
                {savePending ? "保存中..." : "保存设置"}
              </Button>
              <Button variant="outline" asChild>
                <Link to={`/repo/${owner}/${repo}/collaborators`}>管理协作者</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to={`/repo/${owner}/${repo}`}>查看仓库</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Labels</CardTitle>
          <CardDescription>管理 issue / pull request 使用的标签。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {labels.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前还没有标签。</p>
          ) : (
            <div className="space-y-4">
              {labels.map((label) => (
                <div key={label.id} className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <RepositoryLabelChip label={label} />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={labelSavingId === label.id}
                        onClick={() => {
                          void handleLabelSave(label);
                        }}
                      >
                        {labelSavingId === label.id ? "保存中..." : "保存"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={labelDeletingId === label.id}
                        onClick={() => {
                          void handleLabelDelete(label.id);
                        }}
                      >
                        {labelDeletingId === label.id ? "删除中..." : "删除"}
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                    <div className="space-y-2">
                      <Label>名称</Label>
                      <Input
                        value={label.name}
                        onChange={(event) => {
                          const nextName = event.target.value;
                          setLabels((previous) =>
                            previous.map((item) =>
                              item.id === label.id ? { ...item, name: nextName } : item
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>颜色</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={label.color}
                          className="h-10 w-14 p-1"
                          onChange={(event) => {
                            const nextColor = event.target.value;
                            setLabels((previous) =>
                              previous.map((item) =>
                                item.id === label.id ? { ...item, color: nextColor } : item
                              )
                            );
                          }}
                        />
                        <Input
                          value={label.color}
                          onChange={(event) => {
                            const nextColor = event.target.value;
                            setLabels((previous) =>
                              previous.map((item) =>
                                item.id === label.id ? { ...item, color: nextColor } : item
                              )
                            );
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>描述</Label>
                    <Input
                      value={label.description ?? ""}
                      onChange={(event) => {
                        const nextDescription = event.target.value;
                        setLabels((previous) =>
                          previous.map((item) =>
                            item.id === label.id
                              ? {
                                  ...item,
                                  description: nextDescription.trim() ? nextDescription : null
                                }
                              : item
                          )
                        );
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <form className="space-y-4 rounded-md border border-dashed p-4" onSubmit={handleCreateLabel}>
            <div className="grid gap-4 md:grid-cols-[1fr_160px]">
              <div className="space-y-2">
                <Label htmlFor="new-label-name">新标签名称</Label>
                <Input
                  id="new-label-name"
                  value={newLabelName}
                  onChange={(event) => setNewLabelName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-label-color">颜色</Label>
                <div className="flex gap-2">
                  <Input
                    id="new-label-color"
                    type="color"
                    value={newLabelColor}
                    className="h-10 w-14 p-1"
                    onChange={(event) => setNewLabelColor(event.target.value)}
                  />
                  <Input value={newLabelColor} onChange={(event) => setNewLabelColor(event.target.value)} />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-label-description">描述</Label>
              <Input
                id="new-label-description"
                value={newLabelDescription}
                onChange={(event) => setNewLabelDescription(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={creatingLabel}>
              {creatingLabel ? "创建中..." : "创建标签"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Milestones</CardTitle>
          <CardDescription>规划交付节点，并让 issues / pull requests 归档到统一里程碑。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前还没有里程碑。</p>
          ) : (
            <div className="space-y-4">
              {milestones.map((milestone) => (
                <div key={milestone.id} className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium">{milestone.title}</h3>
                      <Badge variant={milestone.state === "open" ? "outline" : "secondary"}>
                        {milestone.state}
                      </Badge>
                      {milestone.due_at ? (
                        <Badge variant="outline">due {formatDateInput(milestone.due_at)}</Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={milestoneSavingId === milestone.id}
                        onClick={() => {
                          void handleMilestoneSave(milestone);
                        }}
                      >
                        {milestoneSavingId === milestone.id ? "保存中..." : "保存"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={milestoneDeletingId === milestone.id}
                        onClick={() => {
                          void handleMilestoneDelete(milestone.id);
                        }}
                      >
                        {milestoneDeletingId === milestone.id ? "删除中..." : "删除"}
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>标题</Label>
                      <Input
                        value={milestone.title}
                        onChange={(event) => {
                          const nextTitle = event.target.value;
                          setMilestones((previous) =>
                            previous.map((item) =>
                              item.id === milestone.id ? { ...item, title: nextTitle } : item
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>截止日期</Label>
                      <Input
                        type="date"
                        value={formatDateInput(milestone.due_at)}
                        onChange={(event) => {
                          const nextDueAt = parseDateInput(event.target.value);
                          setMilestones((previous) =>
                            previous.map((item) =>
                              item.id === milestone.id ? { ...item, due_at: nextDueAt } : item
                            )
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>描述</Label>
                    <Textarea
                      rows={3}
                      value={milestone.description}
                      onChange={(event) => {
                        const nextDescription = event.target.value;
                        setMilestones((previous) =>
                          previous.map((item) =>
                            item.id === milestone.id
                              ? { ...item, description: nextDescription }
                              : item
                          )
                        );
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`milestone-open-${milestone.id}`}
                      checked={milestone.state === "open"}
                      onCheckedChange={(checked) => {
                        setMilestones((previous) =>
                          previous.map((item) =>
                            item.id === milestone.id
                              ? {
                                  ...item,
                                  state: checked === true ? "open" : "closed"
                                }
                              : item
                          )
                        );
                      }}
                    />
                    <Label htmlFor={`milestone-open-${milestone.id}`}>保持为 open</Label>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form className="space-y-4 rounded-md border border-dashed p-4" onSubmit={handleCreateMilestone}>
            <div className="space-y-2">
              <Label htmlFor="new-milestone-title">新里程碑标题</Label>
              <Input
                id="new-milestone-title"
                value={newMilestoneTitle}
                onChange={(event) => setNewMilestoneTitle(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-milestone-description">描述</Label>
              <Textarea
                id="new-milestone-description"
                rows={3}
                value={newMilestoneDescription}
                onChange={(event) => setNewMilestoneDescription(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-milestone-due-at">截止日期</Label>
              <Input
                id="new-milestone-due-at"
                type="date"
                value={newMilestoneDueAt}
                onChange={(event) => setNewMilestoneDueAt(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={creatingMilestone}>
              {creatingMilestone ? "创建中..." : "创建里程碑"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>删除后不可恢复，仓库对象也会从存储中移除。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleDelete}>
            <div className="space-y-2">
              <Label htmlFor="confirmRepoName">输入仓库名确认删除</Label>
              <Input
                id="confirmRepoName"
                value={confirmRepoName}
                onChange={(event) => setConfirmRepoName(event.target.value)}
                placeholder={repo}
                required
              />
            </div>
            <Button type="submit" variant="destructive" disabled={deletePending}>
              {deletePending ? "删除中..." : "删除仓库"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
