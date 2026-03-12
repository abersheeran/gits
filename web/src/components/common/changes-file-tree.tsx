import { ChevronDown, ChevronRight, FileCode2, FolderOpen } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { RepositoryCompareChange } from "@/lib/api";
import { cn } from "@/lib/utils";

type ChangesFileTreeProps = {
  changes: RepositoryCompareChange[];
  activePath: string | null;
  onSelectPath: (path: string) => void;
  getFileBadges?: (change: RepositoryCompareChange) => ReactNode;
  className?: string;
};

type TreeDirectoryNode = {
  kind: "directory";
  name: string;
  path: string;
  children: TreeNode[];
};

type TreeFileNode = {
  kind: "file";
  change: RepositoryCompareChange;
};

type TreeNode = TreeDirectoryNode | TreeFileNode;

type TreeDirectoryBuilder = {
  name: string;
  path: string;
  directories: Map<string, TreeDirectoryBuilder>;
  files: Map<string, RepositoryCompareChange>;
  order: Array<
    | { kind: "directory"; key: string }
    | { kind: "file"; key: string }
  >;
};

function createDirectoryBuilder(name: string, path: string): TreeDirectoryBuilder {
  return {
    name,
    path,
    directories: new Map<string, TreeDirectoryBuilder>(),
    files: new Map<string, RepositoryCompareChange>(),
    order: []
  };
}

function finalizeDirectory(builder: TreeDirectoryBuilder): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const entry of builder.order) {
    if (entry.kind === "directory") {
      const directory = builder.directories.get(entry.key);
      if (!directory) {
        continue;
      }
      nodes.push({
        kind: "directory",
        name: directory.name,
        path: directory.path,
        children: finalizeDirectory(directory)
      });
      continue;
    }

    const change = builder.files.get(entry.key);
    if (!change) {
      continue;
    }
    nodes.push({
      kind: "file",
      change
    });
  }

  return nodes;
}

function buildChangeTree(changes: RepositoryCompareChange[]): TreeNode[] {
  const root = createDirectoryBuilder("", "");

  for (const change of changes) {
    const segments = change.path.split("/").filter(Boolean);
    if (segments.length === 0) {
      root.files.set(change.path, change);
      root.order.push({ kind: "file", key: change.path });
      continue;
    }

    let currentDirectory = root;
    let currentPath = "";

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let nextDirectory = currentDirectory.directories.get(segment);
      if (!nextDirectory) {
        nextDirectory = createDirectoryBuilder(segment, currentPath);
        currentDirectory.directories.set(segment, nextDirectory);
        currentDirectory.order.push({ kind: "directory", key: segment });
      }
      currentDirectory = nextDirectory;
    }

    currentDirectory.files.set(change.path, change);
    currentDirectory.order.push({ kind: "file", key: change.path });
  }

  return finalizeDirectory(root);
}

function collectDirectoryPaths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind === "file") {
      return [];
    }
    return [node.path, ...collectDirectoryPaths(node.children)];
  });
}

function changeStatusBadgeVariant(status: RepositoryCompareChange["status"]) {
  switch (status) {
    case "added":
      return "success";
    case "deleted":
      return "destructive";
    default:
      return "secondary";
  }
}

function changeStatusShortLabel(status: RepositoryCompareChange["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    default:
      return "M";
  }
}

type TreeBranchProps = {
  nodes: TreeNode[];
  depth: number;
  activePath: string | null;
  expandedPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  onSelectPath: (path: string) => void;
  getFileBadges?: (change: RepositoryCompareChange) => ReactNode;
};

function TreeBranch({
  nodes,
  depth,
  activePath,
  expandedPaths,
  onToggleDirectory,
  onSelectPath,
  getFileBadges
}: TreeBranchProps) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => {
        if (node.kind === "directory") {
          const isExpanded = expandedPaths.has(node.path);
          return (
            <li key={node.path} className="space-y-1">
              <button
                type="button"
                onClick={() => onToggleDirectory(node.path)}
                className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-label-sm text-text-secondary transition-colors hover:bg-surface-base hover:text-text-primary"
                style={{ paddingLeft: `${depth * 16 + 12}px` }}
                aria-expanded={isExpanded}
              >
                {isExpanded ? (
                  <ChevronDown className="size-4 shrink-0 text-text-supporting" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-text-supporting" />
                )}
                <FolderOpen className="size-4 shrink-0 text-text-supporting" />
                <span className="truncate">{node.name}</span>
              </button>
              {isExpanded ? (
                <TreeBranch
                  nodes={node.children}
                  depth={depth + 1}
                  activePath={activePath}
                  expandedPaths={expandedPaths}
                  onToggleDirectory={onToggleDirectory}
                  onSelectPath={onSelectPath}
                  getFileBadges={getFileBadges}
                />
              ) : null}
            </li>
          );
        }

        const fileBadges = getFileBadges?.(node.change);
        const isActive = activePath === node.change.path;

        return (
          <li key={node.change.path}>
            <button
              type="button"
              onClick={() => onSelectPath(node.change.path)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-full border px-3 py-2 text-left transition-colors",
                isActive
                  ? "border-border-default bg-surface-base text-text-primary shadow-sm"
                  : "border-transparent bg-transparent text-text-secondary hover:border-border-subtle hover:bg-surface-base hover:text-text-primary"
              )}
              style={{ paddingLeft: `${depth * 16 + 12}px` }}
            >
              <FileCode2 className="size-4 shrink-0 text-text-supporting" />
              <span className="min-w-0 flex-1 truncate text-label-sm">
                {node.change.path.split("/").at(-1) ?? node.change.path}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {fileBadges}
                <Badge
                  variant={changeStatusBadgeVariant(node.change.status)}
                  className="min-w-7 justify-center px-2 font-mono text-[11px]"
                >
                  {changeStatusShortLabel(node.change.status)}
                </Badge>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ChangesFileTree({
  changes,
  activePath,
  onSelectPath,
  getFileBadges,
  className
}: ChangesFileTreeProps) {
  const tree = useMemo(() => buildChangeTree(changes), [changes]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(tree), [tree]);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const expandedPaths = useMemo(() => {
    return new Set(directoryPaths.filter((path) => !collapsedPaths.has(path)));
  }, [collapsedPaths, directoryPaths]);

  function toggleDirectory(path: string) {
    setCollapsedPaths((previous) => {
      const next = new Set(previous);
      if (directoryPaths.includes(path) && !next.has(path)) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }

  return (
    <div className={cn("overflow-y-auto p-3", className)}>
      <TreeBranch
        nodes={tree}
        depth={0}
        activePath={activePath}
        expandedPaths={expandedPaths}
        onToggleDirectory={toggleDirectory}
        onSelectPath={onSelectPath}
        getFileBadges={getFileBadges}
      />
    </div>
  );
}
