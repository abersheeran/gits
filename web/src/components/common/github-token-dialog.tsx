import { useRef, useState, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
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
import { HelpTip } from "./help-tip";
import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import { createGithubConnection, replaceGithubToken } from "@/lib/github-api";
export function GithubTokenDialog({
  connectionId,
  onClose,
  onSaved
}: {
  connectionId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const tokenInput = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (connectionId) await replaceGithubToken(connectionId, token.trim());
      else await createGithubConnection(token.trim());
      setToken("");
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
          tokenInput.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>{connectionId ? "更换令牌" : "添加 GitHub 账号"}</DialogTitle>
          <DialogDescription className="text-body-xs">
            使用 GitHub 个人访问令牌连接账号。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <ErrorAlert error={error} />
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="github-token">GitHub 令牌</Label>
              <HelpTip label="令牌权限说明">
                经典令牌需要 repo 与 read:org
                范围；细粒度令牌只能访问一个账号或组织，每个组织需单独添加
              </HelpTip>
            </div>
            <Input
              ref={tokenInput}
              id="github-token"
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={pending}
              required
            />
            <a
              className="gh-link inline-flex min-h-10 items-center gap-2 text-body-xs font-medium underline underline-offset-4"
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noreferrer"
            >
              在 GitHub 创建令牌
              <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              取消
            </Button>
            <PendingButton type="submit" pending={pending} pendingText="保存中…">
              {connectionId ? "更换令牌" : "添加账号"}
            </PendingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
