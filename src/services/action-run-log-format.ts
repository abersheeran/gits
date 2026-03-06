type ActionRunLifecycleTimestamps = {
  claimedAt?: number | null | undefined;
  startedAt?: number | null | undefined;
  reconciledAt?: number | null | undefined;
};

function formatTimestamp(value: number): string {
  return `${new Date(value).toISOString()} (${value})`;
}

export function buildActionRunLifecycleLines(
  input: ActionRunLifecycleTimestamps,
  options?: { includeMissing?: boolean }
): string[] {
  const includeMissing = options?.includeMissing ?? false;
  const entries = [
    ["claimed_at", input.claimedAt],
    ["started_at", input.startedAt],
    ["reconciled_at", input.reconciledAt]
  ] as const;

  const visibleEntries = includeMissing
    ? entries
    : entries.filter(([, value]) => typeof value === "number");
  if (visibleEntries.length === 0) {
    return [];
  }

  return [
    "[lifecycle]",
    ...visibleEntries.map(([label, value]) =>
      `${label}: ${typeof value === "number" ? formatTimestamp(value) : "-"}`
    )
  ];
}
