import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/common/page-header";
import { ErrorAlert } from "@/components/common/error-alert";
import { PendingButton } from "@/components/ui/pending-button";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/panel";
import { VisibilityField } from "@/components/common/visibility-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createRepository, formatApiError, type AuthUser } from "@/lib/api";

type NewRepositoryPageProps = {
  user: AuthUser | null;
};

export function NewRepositoryPage({ user }: NewRepositoryPageProps) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  const owner = user.username;

  async function handleCreateRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createPending) {
      return;
    }

    const repositoryName = name.trim();
    setCreatePending(true);
    setCreateError(null);
    try {
      await createRepository({
        name: repositoryName,
        ...(description.trim() ? { description: description.trim() } : {}),
        isPrivate
      });
      navigate(`/repo/${owner}/${repositoryName}`, { replace: true });
    } catch (submitError) {
      setCreateError(formatApiError(submitError));
    } finally {
      setCreatePending(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="新建仓库" />
      <Panel>
        <div className="p-4">
          <form className="space-y-4" onSubmit={handleCreateRepository}>
            <div className="space-y-2">
              <Label htmlFor="repo-name">仓库名</Label>
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[13px] text-text-secondary">
                  {user.username} /
                </span>
                <Input
                  id="repo-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="repo-description">描述（可选）</Label>
              <Textarea
                id="repo-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </div>
            <VisibilityField
              value={isPrivate ? "private" : "public"}
              onChange={(value) => setIsPrivate(value === "private")}
            />

            <ErrorAlert error={createError} title="创建失败" />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" asChild>
                <Link to="/dashboard">取消</Link>
              </Button>
              <PendingButton type="submit" pending={createPending} pendingText="创建中…">
                创建仓库
              </PendingButton>
            </div>
          </form>
        </div>
      </Panel>
    </div>
  );
}
