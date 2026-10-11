import { useState, type FormEvent } from "react";
import { Globe, Lock, Pencil } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { formatApiError } from "@/lib/api";
import { ErrorAlert } from "./error-alert";
import { IconButton } from "./icon-button";
import { VisibilityField } from "./visibility-field";

type Visibility = "private" | "public";

export function RepositoryVisibilitySetting({
  value,
  mirror = false,
  onSave
}: {
  value: Visibility;
  mirror?: boolean;
  onSave: (value: Visibility) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = value === "private" ? Lock : Globe;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onSave(draft);
      setOpen(false);
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-2">
        <p className="text-body-xs">可见性</p>
        <p className="flex items-center gap-2 text-body-xs text-text-secondary">
          <Icon className="size-4" aria-hidden="true" />
          {value === "private" ? "私有" : "公开"}
        </p>
      </div>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (pending) return;
        if (nextOpen) {
          setDraft(value);
          setError(null);
        }
        setOpen(nextOpen);
      }}>
        <DialogTrigger asChild>
          <IconButton label="修改可见性">
            <Pencil className="size-4" />
          </IconButton>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改可见性</DialogTitle>
            <DialogDescription>
              {mirror
                ? "修改仅影响 gits 上的访问权限，后续同步会保留你的选择。"
                : "选择谁可以浏览和克隆此仓库。"}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={save}>
            <ErrorAlert error={error} />
            <VisibilityField value={draft} onChange={setDraft} disabled={pending} />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                取消
              </Button>
              <PendingButton type="submit" pending={pending} pendingText="保存中…">
                保存
              </PendingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
