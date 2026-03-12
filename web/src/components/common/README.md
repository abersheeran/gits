# Common Components

## `ChangesWorkspace`

- Path: `web/src/components/common/changes-workspace.tsx`
- Use for commit / compare / PR changes pages that need a GitHub-like review layout with a left file tree and a right diff column.
- Pair it with `RepositoryDiffView` via `sectionIdForPath`, so tree clicks can scroll to the matching diff section.

## `ChangesFileTree`

- Path: `web/src/components/common/changes-file-tree.tsx`
- Use for rendering changed files as a collapsible directory tree with file status badges and optional per-file metadata badges.
- Keep file-level badges lightweight so long file names remain scannable.

## `DetailSection`

- Path: `web/src/components/common/detail-section.tsx`
- Use for page detail blocks that need a shared panel shell, optional title/description, and right-aligned header actions.
- Prefer the `muted` variant for secondary sections that should visually step back from the primary content.

## `HelpTip`

- Path: `web/src/components/common/help-tip.tsx`
- Use for inline explanations that should appear from a `?` icon with tooltip content instead of adding instructional banners to the page.
- Keep tooltip copy brief so it stays readable within the compact popover width.

## `LabeledSelectField`

- Path: `web/src/components/common/labeled-select-field.tsx`
- Use for simple labeled select controls built from the shared shadcn `Select` primitives when the field only needs a label, current value, and option list.
- Pass stable string values in `options` so the generic `onValueChange` contract remains predictable across forms.
