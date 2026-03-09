import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { CopyButton } from "@/components/copy-button";
import { RepositoryLabelChip } from "@/components/repository/repository-label-chip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createRepositoryBranch,
  createRepositoryLabel,
  createRepositoryMilestone,
  deleteRepositoryBranch,
  deleteRepositoryLabel,
  deleteRepositoryMilestone,
  deleteRepository,
  formatApiError,
  getRepositoryDetail,
  listRepositoryLabels,
  listRepositoryMilestones,
  updateRepositoryDefaultBranch,
  updateRepositoryLabel,
  updateRepositoryMilestone,
  updateRepository,
  type AuthUser,
  type RepositoryDetailResponse,
  type RepositoryLabelRecord,
  type RepositoryMilestoneRecord
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

function normalizeBranchName(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
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

  const [defaultBranchDraft, setDefaultBranchDraft] = useState("");
  const [branchNameDraft, setBranchNameDraft] = useState("");
  const [branchSourceOidDraft, setBranchSourceOidDraft] = useState("");
  const [branchSubmitting, setBranchSubmitting] = useState(false);
  const [defaultBranchPending, setDefaultBranchPending] = useState(false);
  const [branchDeletingName, setBranchDeletingName] = useState<string | null>(null);

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
        setDefaultBranchDraft(data.defaultBranch ?? "");
        setBranchSourceOidDraft(data.headOid ?? "");
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
  const branchItems = useMemo(
    () => detail?.branches.map((branch) => ({ ...branch, shortName: normalizeBranchName(branch.name) })) ?? [],
    [detail]
  );

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
    return (
      <PageLoadingState
        title="Loading repository settings"
        description={`Fetching repository settings, branch controls, labels, and milestones for ${owner}/${repo}.`}
      />
    );
  }

  if (detail.repository.owner_username !== user.username) {
    return (
      <Alert variant="destructive">
        <AlertTitle>无权限</AlertTitle>
        <AlertDescription>只有仓库 owner 可修改设置。</AlertDescription>
      </Alert>
    );
  }

  async function refreshRepositoryDetail(nextOwner = owner, nextRepo = repo) {
    const reloaded = await getRepositoryDetail(nextOwner, nextRepo);
    setDetail(reloaded);
    setDefaultBranchDraft(reloaded.defaultBranch ?? "");
    setBranchSourceOidDraft(reloaded.headOid ?? "");
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
        await refreshRepositoryDetail();
      }
    } catch (submitError) {
      setFormError(formatApiError(submitError));
    } finally {
      setSavePending(false);
    }
  }

  async function handleCreateBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (branchSubmitting) {
      return;
    }

    setBranchSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      const createdBranchName = branchNameDraft.trim();
      await createRepositoryBranch(owner, repo, {
        branchName: createdBranchName,
        sourceOid: branchSourceOidDraft.trim()
      });
      await refreshRepositoryDetail();
      setBranchNameDraft("");
      setNotice(`分支 ${createdBranchName} 已创建`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setBranchSubmitting(false);
    }
  }

  async function handleUpdateDefaultBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (defaultBranchPending || !defaultBranchDraft) {
      return;
    }

    setDefaultBranchPending(true);
    setFormError(null);
    setNotice(null);
    try {
      await updateRepositoryDefaultBranch(owner, repo, {
        branchName: defaultBranchDraft
      });
      await refreshRepositoryDetail();
      setNotice(`默认分支已切换到 ${defaultBranchDraft}`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setDefaultBranchPending(false);
    }
  }

  async function handleDeleteBranch(branchName: string) {
    setBranchDeletingName(branchName);
    setFormError(null);
    setNotice(null);
    try {
      await deleteRepositoryBranch(owner, repo, branchName);
      await refreshRepositoryDetail();
      setNotice(`分支 ${branchName} 已删除`);
    } catch (error) {
      setFormError(formatApiError(error));
    } finally {
      setBranchDeletingName(null);
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
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to={`/repo/${owner}/${repo}`}>{owner}</Link>
          <span>/</span>
          <span>{repo}</span>
          <Badge variant="secondary">Settings</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">仓库设置</h1>
        <p className="text-sm text-muted-foreground">管理仓库基本信息、分支、标签、里程碑与删除操作。</p>
      </div>

      {formError ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>已更新</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>修改仓库名称、描述和可见性。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Clone URL</Label>
            <div className="flex items-center gap-2">
              <Input value={cloneUrl} readOnly />
              <CopyButton value={cloneUrl} label="复制地址" copiedLabel="已复制" />
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSave}>
            <div className="grid gap-4 md:grid-cols-2">
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
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="repo-private"
                checked={isPrivate}
                onCheckedChange={(checked) => setIsPrivate(checked === true)}
              />
              <Label htmlFor="repo-private">私有仓库</Label>
            </div>
            <PendingButton type="submit" pending={savePending} pendingText="保存中...">
              保存设置
            </PendingButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <CardDescription>创建分支、删除分支，并修改仓库默认分支。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end" onSubmit={handleUpdateDefaultBranch}>
            <div className="space-y-2">
              <Label htmlFor="default-branch">默认分支</Label>
              <Select value={defaultBranchDraft} onValueChange={setDefaultBranchDraft}>
                <SelectTrigger id="default-branch">
                  <SelectValue placeholder="选择默认分支" />
                </SelectTrigger>
                <SelectContent>
                  {branchItems.map((branch) => (
                    <SelectItem key={branch.name} value={branch.shortName}>
                      {branch.shortName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>当前默认分支</Label>
              <div className="flex h-9 items-center rounded-md border px-3 text-sm">{detail.defaultBranch ?? "none"}</div>
            </div>
            <PendingButton type="submit" pending={defaultBranchPending} pendingText="切换中...">
              切换默认分支
            </PendingButton>
          </form>

          <form className="space-y-4 rounded-md border border-dashed p-4" onSubmit={handleCreateBranch}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-branch-name">新分支名</Label>
                <Input
                  id="new-branch-name"
                  value={branchNameDraft}
                  onChange={(event) => setBranchNameDraft(event.target.value)}
                  placeholder="feature/new-ui"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-branch-source-oid">起点 commit OID</Label>
                <Input
                  id="new-branch-source-oid"
                  value={branchSourceOidDraft}
                  onChange={(event) => setBranchSourceOidDraft(event.target.value)}
                  placeholder="40 位 commit SHA"
                  required
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">默认会预填当前页面选中的 HEAD commit，可按需替换成任意已存在的 commit SHA。</p>
            <PendingButton type="submit" pending={branchSubmitting} pendingText="创建中...">
              创建分支
            </PendingButton>
          </form>

          <div className="space-y-3">
            {branchItems.map((branch) => {
              const isDefault = branch.shortName === detail.defaultBranch;
              return (
                <div
                  key={branch.name}
                  className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{branch.shortName}</span>
                      {isDefault ? <Badge>default</Badge> : null}
                    </div>
                    <div className="break-all text-xs text-muted-foreground">{branch.oid}</div>
                  </div>
                  <PendingButton
                    type="button"
                    variant="outline"
                    pending={branchDeletingName === branch.shortName}
                    pendingText="删除中..."
                    disabled={isDefault}
                    onClick={() => {
                      void handleDeleteBranch(branch.shortName);
                    }}
                  >
                    删除分支
                  </PendingButton>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Labels</CardTitle>
          <CardDescription>维护 Issue / PR 标签定义。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {labels.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有标签。</p>
          ) : (
            <div className="space-y-4">
              {labels.map((label) => (
                <div key={label.id} className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <RepositoryLabelChip label={label} />
                      <p className="text-xs text-muted-foreground">创建于 {new Date(label.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <PendingButton
                        type="button"
                        size="sm"
                        pending={labelSavingId === label.id}
                        pendingText="保存中..."
                        onClick={() => {
                          void handleLabelSave(label);
                        }}
                      >
                        保存
                      </PendingButton>
                      <PendingButton
                        type="button"
                        size="sm"
                        variant="outline"
                        pending={labelDeletingId === label.id}
                        pendingText="删除中..."
                        onClick={() => {
                          void handleLabelDelete(label.id);
                        }}
                      >
                        删除
                      </PendingButton>
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
            <PendingButton type="submit" pending={creatingLabel} pendingText="创建中...">
              创建标签
            </PendingButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Milestones</CardTitle>
          <CardDescription>维护仓库里程碑计划。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有里程碑。</p>
          ) : (
            <div className="space-y-4">
              {milestones.map((milestone) => (
                <div key={milestone.id} className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{milestone.title}</span>
                        <Badge variant={milestone.state === "open" ? "default" : "secondary"}>{milestone.state}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">创建于 {new Date(milestone.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex gap-2">
                      <PendingButton
                        type="button"
                        size="sm"
                        pending={milestoneSavingId === milestone.id}
                        pendingText="保存中..."
                        onClick={() => {
                          void handleMilestoneSave(milestone);
                        }}
                      >
                        保存
                      </PendingButton>
                      <PendingButton
                        type="button"
                        size="sm"
                        variant="outline"
                        pending={milestoneDeletingId === milestone.id}
                        pendingText="删除中..."
                        onClick={() => {
                          void handleMilestoneDelete(milestone.id);
                        }}
                      >
                        删除
                      </PendingButton>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-[1fr_200px]">
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
                            item.id === milestone.id ? { ...item, description: nextDescription } : item
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
            <PendingButton type="submit" pending={creatingMilestone} pendingText="创建中...">
              创建里程碑
            </PendingButton>
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
            <PendingButton
              type="submit"
              variant="destructive"
              pending={deletePending}
              pendingText="删除中..."
            >
              删除仓库
            </PendingButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
