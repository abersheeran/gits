import { useId, useState, type ReactNode } from "react";
import type { RepositoryCommitChange } from "@/lib/api";
import { ChangesFileTree } from "./changes-file-tree";

type ChangesWorkspaceRenderArgs = {
  activePath: string | null;
  setActivePath: (path: string) => void;
  sectionIdForPath: (path: string) => string;
};

type ChangesWorkspaceProps = {
  changes: RepositoryCommitChange[];
  children: (args: ChangesWorkspaceRenderArgs) => ReactNode;
};

export function ChangesWorkspace({ changes, children }: ChangesWorkspaceProps) {
  const workspaceId = useId().replaceAll(":", "");
  const [preferredActivePath, setPreferredActivePath] = useState<string | null>(
    changes[0]?.path ?? null
  );
  const activePath =
    preferredActivePath && changes.some((change) => change.path === preferredActivePath)
      ? preferredActivePath
      : (changes[0]?.path ?? null);

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
    <div className="grid gap-4 xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
      <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h3 className="text-body-xs font-medium text-text-primary">变更文件</h3>
          <span className="text-body-micro text-text-tertiary">{changes.length}</span>
        </div>
        <ChangesFileTree
          changes={changes}
          activePath={activePath}
          onSelectPath={scrollToPath}
          className="max-h-[28rem] xl:max-h-[calc(100dvh-12rem)]"
        />
      </aside>

      <div className="min-w-0">
        {children({
          activePath,
          setActivePath: updateActivePath,
          sectionIdForPath
        })}
      </div>
    </div>
  );
}
