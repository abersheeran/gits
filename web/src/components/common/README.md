# Common Components

## `ChangesWorkspace`

- Path: `web/src/components/common/changes-workspace.tsx`
- Use for commit changes with a left file tree and a right diff column.
- Pair it with `RepositoryDiffView` via `sectionIdForPath`, so tree clicks can scroll to the matching diff section.

## `ChangesFileTree`

- Path: `web/src/components/common/changes-file-tree.tsx`
- Use for rendering changed files as a collapsible directory tree with file status badges.
- Keep file-level badges lightweight so long file names remain scannable.

## `HelpTip`

- Path: `web/src/components/common/help-tip.tsx`
- Use for inline explanations that should appear from a `?` icon with tooltip content instead of adding instructional banners to the page.
- Keep tooltip copy brief so it stays readable within the compact popover width.
