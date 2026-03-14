import { useId, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { RepositoryCompareChange } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChangesFileTree } from "./changes-file-tree";

type ChangesWorkspaceRenderArgs = {
  activePath: string | null;
  setActivePath: (path: string) => void;
  scrollToPath: (path: string) => void;
  sectionIdForPath: (path: string) => string;
};

type ChangesWorkspaceProps = {
  changes: RepositoryCompareChange[];
  children: (args: ChangesWorkspaceRenderArgs) => ReactNode;
  getFileBadges?: (change: RepositoryCompareChange) => ReactNode;
  className?: string;
  fileTreeClassName?: string;
  diffClassName?: string;
};

export function ChangesWorkspace({
  changes,
  children,
  getFileBadges,
  className,
  fileTreeClassName,
  diffClassName
}: ChangesWorkspaceProps) {
  const workspaceId = useId().replaceAll(":", "");
  const [preferredActivePath, setPreferredActivePath] = useState<string | null>(
    changes[0]?.path ?? null
  );
  const activePath =
    preferredActivePath && changes.some((change) => change.path === preferredActivePath)
      ? preferredActivePath
      : changes[0]?.path ?? null;

  function sectionIdForPath(path: string): string {
    return `changes-section-${workspaceId}-${encodeURIComponent(path)}`;
  }

  function updateActivePath(path: string) {
    setPreferredActivePath(path);
  }

  function scrollToPath(path: string) {
    setPreferredActivePath(path);
    requestAnimationFrame(() => {
      document.getElementById(sectionIdForPath(path))?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  }

  return (
    <div
      className={cn(
        "grid gap-4 xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]",
        className
      )}
    >
      <aside className={cn("min-w-0 xl:sticky xl:top-4 xl:self-start", fileTreeClassName)}>
        <div className="overflow-hidden rounded-[16px] border border-border-subtle bg-surface-focus shadow-container">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <div className="space-y-1">
              <h3 className="font-display text-heading-4 text-text-primary">Changed files</h3>
              <p className="text-body-micro text-text-secondary">
                Navigate the diff by file and status.
              </p>
            </div>
            <Badge variant="outline" className="bg-surface-base">
              {changes.length}
            </Badge>
          </div>
          <ChangesFileTree
            changes={changes}
            activePath={activePath}
            onSelectPath={scrollToPath}
            getFileBadges={getFileBadges}
            className="max-h-[28rem] xl:max-h-[calc(100dvh-12rem)]"
          />
        </div>
      </aside>

      <div className={cn("min-w-0", diffClassName)}>
        {children({
          activePath,
          setActivePath: updateActivePath,
          scrollToPath,
          sectionIdForPath
        })}
      </div>
    </div>
  );
}
