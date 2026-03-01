import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
      navigate("/dashboard", { replace: true });
    } catch (submitError) {
      setCreateError(formatApiError(submitError));
    } finally {
      setCreatePending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>新建仓库</CardTitle>
          <CardDescription>仓库名不能以 .git 结尾，仅支持字母数字和 . _ -。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreateRepository}>
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
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="可选"
                rows={4}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="is-private"
                checked={isPrivate}
                onCheckedChange={(checked) => setIsPrivate(checked === true)}
              />
              <Label htmlFor="is-private">私有仓库</Label>
            </div>

            {createError ? (
              <Alert variant="destructive">
                <AlertTitle>创建失败</AlertTitle>
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={createPending}>
                {createPending ? "创建中..." : "创建仓库"}
              </Button>
              <Button type="button" variant="ghost" asChild>
                <Link to="/dashboard">返回仓库列表</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
