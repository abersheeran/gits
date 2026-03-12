# Common Components

## `ChangesWorkspace`

- Path: `web/src/components/common/changes-workspace.tsx`
- Use for commit / compare / PR changes pages that need a GitHub-like review layout with a left file tree and a right diff column.
- Pair it with `RepositoryDiffView` via `sectionIdForPath`, so tree clicks can scroll to the matching diff section.

## `ChangesFileTree`

- Path: `web/src/components/common/changes-file-tree.tsx`
- Use for rendering changed files as a collapsible directory tree with file status badges and optional per-file metadata badges.
- Keep file-level badges lightweight so long file names remain scannable.
