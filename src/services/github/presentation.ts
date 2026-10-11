import type { RemoteRow, RepositoryState, SourceRow } from "./types";

export const repositoryStates: RepositoryState[] = [
  "excluded", "queued", "syncing", "synced", "failed", "too_large", "name_conflict", "missing"
];

export function mirrorView(row: RemoteRow) {
  return {
    sourceId: row.source_id,
    fullName: row.full_name,
    htmlUrl: row.html_url,
    state: row.state,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error
  };
}

export function remoteView(row: RemoteRow & { owner: string | null; name: string | null }) {
  return {
    githubRepoId: row.github_repo_id,
    fullName: row.full_name,
    htmlUrl: row.html_url,
    description: row.description,
    isPrivate: Boolean(row.is_private),
    isFork: Boolean(row.is_fork),
    isArchived: Boolean(row.is_archived),
    sizeKb: row.size_kb,
    selection: row.selection,
    localName: row.local_name,
    repository: row.owner && row.name ? { owner: row.owner, name: row.name } : null,
    state: row.state,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at
  };
}

export async function sourceView(db: D1Database, source: SourceRow) {
  const result = await db.prepare(
    "SELECT state, COUNT(*) AS count FROM github_repositories WHERE source_id = ? GROUP BY state"
  ).bind(source.id).all<{ state: RepositoryState; count: number }>();
  const counts = Object.fromEntries(
    repositoryStates.map((state) => [state, 0])
  ) as Record<RepositoryState, number>;
  for (const row of result.results) {
    counts[row.state] = row.count;
  }
  const manageUrl = source.account_type === "user"
    ? `https://github.com/settings/installations/${source.installation_id}`
    : `https://github.com/organizations/${encodeURIComponent(source.account_login)}`
      + `/settings/installations/${source.installation_id}`;
  const summary = {
    id: source.id,
    installationId: source.installation_id,
    accountLogin: source.account_login,
    accountType: source.account_type,
    avatarUrl: source.avatar_url,
    repositorySelection: source.repository_selection,
    manageUrl,
    status: source.suspended ? "suspended" : source.paused ? "paused" : source.status,
    lastError: source.last_error,
    lastDiscoveredAt: source.last_discovered_at,
    repositoryCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
    syncedCount: counts.synced,
    attentionCount: counts.failed + counts.too_large + counts.name_conflict + counts.missing
  };
  return {
    summary,
    detail: {
      ...summary,
      namePrefix: source.name_prefix,
      includeForks: Boolean(source.include_forks),
      includeArchived: Boolean(source.include_archived),
      visibilityPolicy: source.visibility_policy,
      linkedBy: source.linked_by_login,
      paused: Boolean(source.paused),
      counts
    }
  };
}

export const remoteSelect = `SELECT g.*, u.username AS owner, r.name
  FROM github_repositories g LEFT JOIN repositories r ON r.id = g.repository_id
  LEFT JOIN users u ON u.id = r.owner_id`;

export type RemoteViewRow = RemoteRow & { owner: string | null; name: string | null };
