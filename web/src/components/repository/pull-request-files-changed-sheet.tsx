import { useRef, useState, type ReactNode, type UIEvent } from "react";
import { ChangesWorkspace } from "@/components/common/changes-workspace";
import { PullRequestInlineThreadComposer } from "@/components/repository/pull-request-inline-thread-composer";
import { AuthorAvatar } from "@/components/repository/author-avatar";
import {
  RepositoryDiffView,
  type RepositoryDiffLineDecoration,
  type RepositoryDiffLineTarget
} from "@/components/repository/repository-diff-view";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import type {
  RepositoryCompareChange,
  RepositoryCompareResponse
} from "@/lib/api";
import { cn } from "@/lib/utils";

const FILES_CHANGED_HEADER_HIDE_OFFSET = 48;
const FILES_CHANGED_HEADER_SCROLL_DELTA = 12;

export type SelectedReviewRange = {
  path: string;
  baseOid: string;
  headOid: string;
  hunkHeader: string;
  side: "head" | "base";
  startLine: number;
  endLine: number;
  anchorLine: number;
};

export type ReviewThreadPathSummary = {
  open: number;
  resolved: number;
};

type PullRequestFilesChangedSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  number: number;
  authorUsername: string;
  headRef: string;
  baseRef: string;
  comparison: RepositoryCompareResponse;
  canReview: boolean;
  selectedReviewRange: SelectedReviewRange | null;
  onDiffLineClick?: (target: RepositoryDiffLineTarget) => void;
  isDiffLineSelected?: (target: RepositoryDiffLineTarget) => boolean;
  lineDecorations?: RepositoryDiffLineDecoration[];
  reviewThreadBody: string;
  onReviewThreadBodyChange: (value: string) => void;
  onClearSelection: () => void;
  onDiscardDraft: () => void;
  onSubmitReviewThread: () => void;
  reviewThreadSubmitting: boolean;
  reviewThreadDisabled: boolean;
  formatSelectedRange: (range: SelectedReviewRange) => string;
  formatCompareLabel: (range: SelectedReviewRange) => string;
  countSelectedLines: (range: SelectedReviewRange) => number;
  getFileBadges?: (change: RepositoryCompareChange) => ReactNode;
  renderChangeHeaderExtras?: (change: RepositoryCompareChange) => ReactNode;
};

function stripHeadsRef(refName: string): string {
  return refName.startsWith("refs/heads/") ? refName.slice("refs/heads/".length) : refName;
}

export function PullRequestFilesChangedSheet({
  open,
  onOpenChange,
  title,
  number,
  authorUsername,
  headRef,
  baseRef,
  comparison,
  canReview,
  selectedReviewRange,
  onDiffLineClick,
  isDiffLineSelected,
  lineDecorations,
  reviewThreadBody,
  onReviewThreadBodyChange,
  onClearSelection,
  onDiscardDraft,
  onSubmitReviewThread,
  reviewThreadSubmitting,
  reviewThreadDisabled,
  formatSelectedRange,
  formatCompareLabel,
  countSelectedLines,
  getFileBadges,
  renderChangeHeaderExtras
}: PullRequestFilesChangedSheetProps) {
  const previousScrollTopRef = useRef(0);
  const headerHiddenRef = useRef(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const description = [authorUsername, `${stripHeadsRef(headRef)} → ${stripHeadsRef(baseRef)}`]
    .filter(Boolean)
    .join(" · ");

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

    if (nextScrollTop <= FILES_CHANGED_HEADER_HIDE_OFFSET) {
      updateHeaderVisibility(false);
    } else if (scrollDelta > FILES_CHANGED_HEADER_SCROLL_DELTA) {
      updateHeaderVisibility(true);
    } else if (scrollDelta < -FILES_CHANGED_HEADER_SCROLL_DELTA) {
      updateHeaderVisibility(false);
    }

    previousScrollTopRef.current = nextScrollTop;
  }

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent
        side="right"
        className="flex h-dvh w-screen max-w-none flex-col gap-0 border-0 bg-surface-elevated p-0 sm:inset-y-3 sm:right-3 sm:h-[calc(100dvh-1.5rem)] sm:w-[min(96vw,1320px)] sm:rounded-[20px] sm:border sm:border-border-subtle"
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
            <div className="flex min-w-0 items-center gap-3">
              <AuthorAvatar name={authorUsername} className="h-9 w-9 text-[12px]" />
              <div className="min-w-0">
                <SheetTitle className="line-clamp-2 text-heading-3-16-semibold">
                  {title}
                </SheetTitle>
                <SheetDescription className="text-body-micro text-text-secondary">
                  {description}
                </SheetDescription>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-body-micro text-text-secondary">
              <Badge variant="outline" className="bg-surface-base">
                #{number}
              </Badge>
              <Badge variant="outline" className="bg-surface-base">
                {comparison.filesChanged} files
              </Badge>
              <Badge variant="outline" className="bg-surface-base">
                +{comparison.additions}
              </Badge>
              <Badge variant="outline" className="bg-surface-base">
                -{comparison.deletions}
              </Badge>
            </div>
          </div>
        </SheetHeader>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-4 sm:py-4"
          onScroll={handleContentScroll}
        >
          <div
            className={cn(
              "grid grid-cols-1 items-start gap-4",
              selectedReviewRange
                ? "grid-cols-[minmax(0,1fr)_380px] max-[960px]:grid-cols-1"
                : ""
            )}
          >
            <ChangesWorkspace changes={comparison.changes} getFileBadges={getFileBadges}>
              {({ activePath, setActivePath, sectionIdForPath }) => (
                <RepositoryDiffView
                  changes={comparison.changes}
                  activePath={activePath}
                  onChangeActivate={(change) => setActivePath(change.path)}
                  sectionIdForPath={sectionIdForPath}
                  onDiffLineClick={
                    canReview
                      ? (target) => {
                          setActivePath(target.change.path);
                          onDiffLineClick?.(target);
                        }
                      : undefined
                  }
                  isDiffLineSelected={isDiffLineSelected}
                  lineDecorations={lineDecorations}
                  renderChangeHeaderExtras={renderChangeHeaderExtras}
                  renderChangeTopPanel={() => null}
                />
              )}
            </ChangesWorkspace>

            {selectedReviewRange ? (
              <aside className="sticky top-0 self-start min-w-0 max-[960px]:static">
                <PullRequestInlineThreadComposer
                  selectedLabel={formatSelectedRange(selectedReviewRange)}
                  compareLabel={formatCompareLabel(selectedReviewRange)}
                  hunkHeader={selectedReviewRange.hunkHeader}
                  side={selectedReviewRange.side}
                  lineCount={countSelectedLines(selectedReviewRange)}
                  body={reviewThreadBody}
                  onBodyChange={onReviewThreadBodyChange}
                  onClearSelection={onClearSelection}
                  onDiscardDraft={onDiscardDraft}
                  onSubmit={onSubmitReviewThread}
                  submitting={reviewThreadSubmitting}
                  disabled={reviewThreadDisabled}
                />
              </aside>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
