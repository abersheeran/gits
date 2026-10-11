import { useRef, useState, type FormEvent } from "react";
import { Globe, Lock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorAlert } from "./error-alert";
import { HelpTip } from "./help-tip";
import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import {
  createGithubSource,
  updateGithubSource,
  type GithubSourceSettings
} from "@/lib/github-api";

// Mount for each editing session so canceled changes never leak into the next source.
export function GithubSourceSettingsSheet({
  ownerLogin,
  connectionId,
  sourceId,
  initial,
  onClose,
  onSaved
}: {
  ownerLogin: string;
  connectionId: string;
  sourceId?: string;
  initial: GithubSourceSettings;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const prefixInput = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<GithubSourceSettings>(() => ({
    namePrefix: initial.namePrefix,
    includeForks: initial.includeForks,
    includeArchived: initial.includeArchived,
    visibilityPolicy: initial.visibilityPolicy,
    intervalMinutes: initial.intervalMinutes,
    paused: initial.paused
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function field<K extends keyof GithubSourceSettings>(key: K, value: GithubSourceSettings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (sourceId) await updateGithubSource(sourceId, settings);
      else await createGithubSource({ connectionId, ownerLogin, ...settings });
      await onSaved();
      onClose();
    } catch (cause) {
      setError(formatApiError(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <SheetContent
        className="w-full max-w-md overflow-y-auto rounded-l-xl p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          prefixInput.current?.focus({ preventScroll: true });
        }}
      >
        <SheetHeader className="pr-10">
          <SheetTitle>{sourceId ? "同步设置" : "启用同步"}</SheetTitle>
          <SheetDescription className="text-body-xs">{ownerLogin}</SheetDescription>
        </SheetHeader>
        <form onSubmit={save} className="mt-4 space-y-4">
          <ErrorAlert error={error} />
          <fieldset disabled={pending} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="github-prefix">本地名称前缀</Label>
                <HelpTip label="仓库在 gits 中的名称为前缀加 GitHub 仓库名" />
              </div>
              <Input
                ref={prefixInput}
                id="github-prefix"
                value={settings.namePrefix}
                onChange={(e) => field("namePrefix", e.target.value)}
              />
              <p className="break-all text-body-micro text-text-tertiary">
                示例：{settings.namePrefix}example-repo
              </p>
            </div>
            <label className="flex min-h-10 items-center gap-3 text-body-xs">
              <Checkbox
                checked={settings.includeForks}
                onCheckedChange={(value) => field("includeForks", value === true)}
                disabled={pending}
              />
              包含 Fork
            </label>
            <label className="flex min-h-10 items-center gap-3 text-body-xs">
              <Checkbox
                checked={settings.includeArchived}
                onCheckedChange={(value) => field("includeArchived", value === true)}
                disabled={pending}
              />
              包含已归档仓库
            </label>
            <fieldset className="space-y-3">
              <legend className="text-body-xs font-medium">可见性</legend>
              {(
                [
                  ["follow", "跟随 GitHub", "与 GitHub 仓库保持相同的可见性", Globe],
                  ["private", "全部设为私有", "只有你和协作者可以访问", Lock]
                ] as const
              ).map(([value, label, description, Icon]) => (
                <label key={value} className="flex min-h-10 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="github-visibility"
                    checked={settings.visibilityPolicy === value}
                    onChange={() => field("visibilityPolicy", value)}
                    className="accent-action-primaryBg"
                  />
                  <Icon className="size-4 shrink-0 text-text-secondary" />
                  <span>
                    <span className="block text-body-xs font-medium">{label}</span>
                    <span className="block text-body-micro text-text-tertiary">{description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="github-interval">同步频率</Label>
              <Select
                disabled={pending}
                value={String(settings.intervalMinutes)}
                onValueChange={(value) =>
                  field("intervalMinutes", Number(value) as GithubSourceSettings["intervalMinutes"])
                }
              >
                <SelectTrigger id="github-interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    [15, "每 15 分钟"],
                    [60, "每小时"],
                    [360, "每 6 小时"],
                    [1440, "每天"]
                  ].map(([value, label]) => (
                    <SelectItem key={value} value={String(value)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sourceId && (
              <button
                type="button"
                role="switch"
                aria-checked={settings.paused}
                disabled={pending}
                onClick={() => field("paused", !settings.paused)}
                className="flex min-h-10 items-center gap-3 text-body-xs disabled:opacity-50"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-9 items-center rounded-full p-0.5 ${settings.paused ? "bg-action-primaryBg" : "bg-fill-primary"}`}
                >
                  <span
                    className={`size-4 rounded-full bg-surface-base transition-transform ${settings.paused ? "translate-x-4" : ""}`}
                  />
                </span>
                暂停同步
              </button>
            )}
          </fieldset>
          <SheetFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              取消
            </Button>
            <PendingButton type="submit" pending={pending} pendingText="保存中…">
              {sourceId ? "保存" : "启用同步"}
            </PendingButton>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
