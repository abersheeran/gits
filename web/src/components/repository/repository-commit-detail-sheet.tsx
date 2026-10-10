import { useRef, useState, type UIEvent } from "react";
import { ChangesWorkspace } from "@/components/common/changes-workspace";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import { RepositoryDiffView } from "@/components/repository/repository-diff-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShaCopyButton } from "@/components/common/sha-copy-button";
import { Button } from "@/components/ui/button";
import { InlineLoadingState } from "@/components/ui/loading-state";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import type { RepositoryCommitDetailResponse } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type RepositoryCommitDetailSheetProps = {
  open: boolean;
  detail: RepositoryCommitDetailResponse | null;
  loading?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onBrowseSnapshot: (commitOid: string) => void;
};

const COMMIT_DETAIL_HEADER_HIDE_OFFSET = 48;
const COMMIT_DETAIL_HEADER_SCROLL_DELTA = 12;

function commitTitle(message: string): string {
  return (message.split("\n")[0] ?? "").trim() || "（无提交说明）";
}

export function RepositoryCommitDetailSheet({
  open,
  detail,
  loading = false,
  error = null,
  onOpenChange,
  onBrowseSnapshot
}: RepositoryCommitDetailSheetProps) {
  const previousScrollTopRef = useRef(0);
  const headerHiddenRef = useRef(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const authoredAt = detail ? formatDateTime(detail.commit.author.timestamp * 1000) : null;
  const title = detail
    ? commitTitle(detail.commit.message)
    : loading
      ? "正在加载"
      : error
        ? "无法加载提交详情"
        : "提交详情";
  const description = detail
    ? `${detail.commit.author.name} · ${authoredAt}`
    : loading
      ? "正在加载"
      : error
        ? "无法加载提交详情"
        : "查看提交改动";

  function updateHeaderVisibility(hidden: boolean) {
    if (headerHiddenRef.current === hidden) {
      return;
    }
    headerHiddenRef.current = hidden;
    setIsHeaderHidden(hidden);
  }

  function handleSheetOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      previousScrollTopRef.current = 0;
      updateHeaderVisibility(false);
    }
    onOpenChange(nextOpen);
  }

  function handleContentScroll(event: UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop;
    const scrollDelta = nextScrollTop - previousScrollTopRef.current;

    if (nextScrollTop <= COMMIT_DETAIL_HEADER_HIDE_OFFSET) {
      updateHeaderVisibility(false);
    } else if (scrollDelta > COMMIT_DETAIL_HEADER_SCROLL_DELTA) {
      updateHeaderVisibility(true);
    } else if (scrollDelta < -COMMIT_DETAIL_HEADER_SCROLL_DELTA) {
      updateHeaderVisibility(false);
    }

    previousScrollTopRef.current = nextScrollTop;
  }

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="right"
        className="flex h-dvh w-screen max-w-none flex-col gap-0 border-0 bg-surface-elevated p-0 sm:inset-y-3 sm:right-3 sm:h-[calc(100dvh-1.5rem)] sm:w-[min(96vw,1320px)] sm:rounded-xl sm:border sm:border-border-subtle"
      >
        <SheetHeader
          className={cn(
            "overflow-hidden bg-surface-focus pl-4 pr-16 text-left transition-[max-height,opacity,transform,padding,border-color] duration-200 ease-out sm:pl-4 sm:pr-16",
            isHeaderHidden
              ? "max-h-0 -translate-y-3 border-b-0 py-0 opacity-0"
              : "max-h-56 border-b border-border-subtle py-4 opacity-100"
          )}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                {detail ? (
                  <AuthorAvatar name={detail.commit.author.name} className="h-9 w-9 text-[12px]" />
                ) : null}
                <div className="min-w-0">
                  <SheetTitle className="line-clamp-2 text-heading-3-16-semibold">
                    {title}
                  </SheetTitle>
                  <SheetDescription className="text-body-micro text-text-secondary">
                    {description}
                  </SheetDescription>
                </div>
              </div>

              {detail ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onBrowseSnapshot(detail.commit.oid)}
                >
                  浏览此时的文件
                </Button>
              ) : null}
            </div>

            {detail ? (
              <div className="flex flex-wrap items-center gap-3 text-body-micro text-text-secondary">
                <ShaCopyButton oid={detail.commit.oid} />
                <span>{detail.filesChanged} 个文件</span>
                <span>+{detail.additions}</span>
                <span>-{detail.deletions}</span>
              </div>
            ) : null}
          </div>
        </SheetHeader>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-4 sm:py-4"
          onScroll={handleContentScroll}
        >
          {loading ? <InlineLoadingState /> : null}

          {!loading && error ? (
            <Alert variant="destructive">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!loading && !error && detail ? (
            <>
              <p className="mb-4 whitespace-pre-wrap break-words text-body-xs text-text-secondary">
                {detail.commit.message.split("\n").slice(1).join("\n").trim()}
              </p>
              <ChangesWorkspace changes={detail.changes}>
                {({ activePath, setActivePath, sectionIdForPath }) => (
                  <RepositoryDiffView
                    changes={detail.changes}
                    activePath={activePath}
                    onChangeActivate={(change) => setActivePath(change.path)}
                    sectionIdForPath={sectionIdForPath}
                  />
                )}
              </ChangesWorkspace>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
