import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PendingButton } from "@/components/ui/pending-button";
import { ErrorAlert } from "./error-alert";
import { formatApiError } from "@/lib/api";
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmName,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmName?: string;
  onConfirm: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function changeOpen(value: boolean) {
    if (pending) return;
    setName("");
    setError(null);
    onOpenChange(value);
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending || (confirmName !== undefined && name !== confirmName)) return;
            setPending(true);
            setError(null);
            try {
              await onConfirm();
              setName("");
              onOpenChange(false);
            } catch (cause) {
              setError(formatApiError(cause));
            } finally {
              setPending(false);
            }
          }}
          className="space-y-4"
        >
          <ErrorAlert error={error} />
          {confirmName !== undefined && (
            <div className="space-y-2">
              <Label htmlFor="confirm-name">输入仓库名 {confirmName} 确认删除</Label>
              <Input
                id="confirm-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              取消
            </Button>
            <PendingButton
              type="submit"
              variant="destructive"
              pending={pending}
              pendingText="处理中…"
              disabled={confirmName !== undefined && name !== confirmName}
            >
              {title}
            </PendingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
