import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useRepository } from "@/hooks/use-repository";
import { RepositoryLayout } from "@/components/common/repository-layout";
import { Panel, PanelTitle } from "@/components/common/panel";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorAlert } from "@/components/common/error-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PageLoadingState } from "@/components/ui/loading-state";
import { PendingButton } from "@/components/ui/pending-button";
import { VisibilityField } from "@/components/common/visibility-field";
import { Check } from "lucide-react";
import {
  deleteRepository,
  formatApiError,
  getRepositoryDetail,
  updateRepository,
  type AuthUser,
  type RepositoryDetailResponse
} from "@/lib/api";

function SettingsForm({
  detail,
  onSaved
}: {
  detail: RepositoryDetailResponse;
  onSaved: (detail: RepositoryDetailResponse) => void;
}) {
  const repository = detail.repository;
  const owner = repository.owner_username;
  const repo = repository.name;
  const navigate = useNavigate();
  const [name, setName] = useState(repo);
  const [description, setDescription] = useState(repository.description ?? "");
  const [visibility, setVisibility] = useState<"private" | "public">(
    repository.is_private ? "private" : "public"
  );
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await updateRepository(owner, repo, {
        name,
        description: description.trim() || null,
        isPrivate: visibility === "private"
      });
      if (name !== repo) {
        navigate(`/repo/${owner}/${name}/settings`, { replace: true });
      } else {
        onSaved(await getRepositoryDetail(owner, repo));
        setSaved(true);
      }
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Panel header="常规">
        <ErrorAlert inset error={error} />
        <form className="space-y-4 p-4" onSubmit={save} onChange={() => setSaved(false)}>
          <div className="space-y-2">
            <Label htmlFor="repo-name">仓库名</Label>
            <Input
              id="repo-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-description">描述</Label>
            <Textarea
              id="repo-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <VisibilityField
            value={visibility}
            onChange={(value) => {
              setVisibility(value);
              setSaved(false);
            }}
          />
          <div className="flex items-center gap-3">
            <PendingButton type="submit" pending={pending} pendingText="保存中…">
              保存
            </PendingButton>
            {saved && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-body-xs text-success"
              >
                <Check className="h-4 w-4" />
                已保存
              </span>
            )}
          </div>
        </form>
      </Panel>
      <Panel header={<PanelTitle className="text-danger-text">危险操作</PanelTitle>}>
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <p className="text-body-xs text-text-secondary">删除仓库及其全部文件，此操作无法撤销。</p>
          <Button variant="destructiveOutline" onClick={() => setDeleting(true)}>
            删除仓库
          </Button>
        </div>
      </Panel>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="删除仓库"
        description="仓库及其提交历史将被永久删除。"
        confirmName={repo}
        onConfirm={async () => {
          await deleteRepository(owner, repo);
          navigate("/dashboard", { replace: true });
        }}
      />
    </>
  );
}
export function RepositorySettingsPage({ user }: { user: AuthUser | null }) {
  const { detail, setDetail, error } = useRepository();
  if (!user) return <Navigate to="/login" replace />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return <PageLoadingState />;
  return (
    <RepositoryLayout detail={detail}>
      {detail.repository.owner_username === user.username ? (
        <SettingsForm key={detail.repository.name} detail={detail} onSaved={setDetail} />
      ) : (
        <ErrorAlert error="只有仓库所有者可以修改设置。" />
      )}
    </RepositoryLayout>
  );
}
