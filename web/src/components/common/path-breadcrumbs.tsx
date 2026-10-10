import { Link } from "react-router-dom";
import type { CodeViewKind } from "@/lib/repository-navigation";

export type LocationLink = (kind: CodeViewKind, path: string) => string;

export function PathBreadcrumbs({
  path,
  kind,
  link,
  repositoryName
}: {
  path: string;
  kind: CodeViewKind;
  link: LocationLink;
  repositoryName: string;
}) {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  return (
    <nav
      aria-label="文件路径"
      className="flex min-w-0 flex-1 flex-wrap items-center gap-1 break-all font-mono text-[13px] font-normal"
    >
      <Link className="gh-link" to={link("tree", "")}>
        {repositoryName}
      </Link>
      {parts.map((part, index) => (
        <span key={index} className="inline-flex min-w-0 items-center gap-1">
          <span className="text-text-tertiary">/</span>
          <Link
            className="gh-link"
            to={link(
              index === parts.length - 1 ? kind : "tree",
              parts.slice(0, index + 1).join("/")
            )}
          >
            {part}
          </Link>
        </span>
      ))}
    </nav>
  );
}
