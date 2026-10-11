import { matchPath, useLocation } from "react-router-dom";
import { BranchSelectSkeleton } from "@/components/common/branch-select";
import { RepositoryContentsSkeleton } from "@/components/common/code-skeletons";
import { CommitListSkeleton, TableSkeleton } from "@/components/common/list-skeletons";
import { Panel, PanelTitle } from "@/components/common/panel";
import { RepositoryCodeToolbar } from "@/components/common/repository-code-toolbar";
import { RepositoryLayout } from "@/components/common/repository-layout";
import { FormSkeleton } from "@/components/common/form-skeleton";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/api";
import { buildCodePath, decodeUriSegment, parseCodeSplatPath } from "@/lib/repository-navigation";

export function RepositoryPageSkeleton({
  owner,
  repo,
  user
}: {
  owner: string;
  repo: string;
  user?: AuthUser | null;
}) {
  const { pathname } = useLocation();
  const base = `/repo/${owner}/${repo}`;
  let content;
  if (pathname === `${base}/commits`) {
    content = (
      <>
        <BranchSelectSkeleton />
        <Panel>
          <CommitListSkeleton rows={8} browseAction />
        </Panel>
      </>
    );
  } else if (pathname === `${base}/settings`) {
    content = (
      <Panel header="常规">
        <FormSkeleton variant="settings" />
      </Panel>
    );
  } else if (pathname === `${base}/branches` || pathname === `${base}/collaborators`) {
    const collaborators = pathname === `${base}/collaborators`;
    content = (
      <Panel
        header={
          <>
            <PanelTitle>{collaborators ? "协作者" : "分支"}</PanelTitle>
            {(collaborators || user?.username === owner) && (
              <Button size="sm" disabled>
                {collaborators ? "添加协作者" : "新建分支"}
              </Button>
            )}
          </>
        }
      >
        <TableSkeleton variant={collaborators ? "collaborators" : "branches"} />
      </Panel>
    );
  } else {
    const match = matchPath("/repo/:owner/:repo/:kind/:ref/*", pathname);
    const kind = match?.params.kind === "blob" ? "blob" : "tree";
    const ref = match?.params.ref ? decodeUriSegment(match.params.ref) : undefined;
    const path = parseCodeSplatPath(match?.params["*"]) ?? "";
    content = (
      <>
        <RepositoryCodeToolbar
          owner={owner}
          repo={repo}
          kind={kind}
          path={path}
          branch={<BranchSelectSkeleton />}
          link={(nextKind, nextPath) =>
            buildCodePath({ owner, repo, kind: nextKind, path: nextPath, ref })
          }
        />
        <RepositoryContentsSkeleton kind={kind} />
      </>
    );
  }
  return (
    <RepositoryLayout owner={owner} repo={repo} detail={null}>
      {content}
    </RepositoryLayout>
  );
}
