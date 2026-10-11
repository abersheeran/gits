import { useRef, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { ErrorAlert } from "./error-alert";
import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import { updateGithubRepository, type GithubRemoteRepository } from "@/lib/github-api";
export function GithubLocalNameDialog({
  sourceId,
  item,
  onSaved,
  onClose
}: {
  sourceId: string;
  item: GithubRemoteRepository;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item.localName ?? item.fullName.split("/").pop() ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
      setError("名称需为 1–100 个字母、数字、点、下划线或连字符。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await updateGithubRepository(sourceId, item.githubRepoId, {
        localName: name,
        selection: "include"
      });
      await onSaved();
      onClose();
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameInput.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>指定本地名称</DialogTitle>
          <DialogDescription className="break-all text-body-xs">{item.fullName}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <ErrorAlert error={error} />
          <div className="space-y-2">
            <Label htmlFor="github-local-name">本地仓库名</Label>
            <Input
              ref={nameInput}
              id="github-local-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="[A-Za-z0-9._\-]{1,100}"
              maxLength={100}
              required
              disabled={pending}
            />
            <p className="text-body-micro text-text-tertiary">
              1–100 个字母、数字、点、下划线或连字符。
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              取消
            </Button>
            <PendingButton type="submit" pending={pending} pendingText="保存中…">
              保存并同步
            </PendingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
