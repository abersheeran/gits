import type { ReactNode } from "react";
import { CopyField } from "@/components/common/copy-field";
import { PathBreadcrumbs, type LocationLink } from "@/components/common/path-breadcrumbs";
import type { CodeViewKind } from "@/lib/repository-navigation";

export function RepositoryCodeToolbar({
  owner,
  repo,
  kind,
  path,
  link,
  branch
}: {
  owner: string;
  repo: string;
  kind: CodeViewKind;
  path: string;
  link: LocationLink;
  branch: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
        {branch}
        <PathBreadcrumbs repositoryName={repo} path={path} kind={kind} link={link} />
      </div>
      <CopyField
        className="md:ml-auto md:w-96 md:shrink-0"
        value={`${window.location.origin}/${owner}/${repo}.git`}
        label="Clone 地址"
      />
    </div>
  );
}
