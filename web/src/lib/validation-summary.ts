import type {
  ActionRunRecord,
  AgentSessionArtifactRecord,
  AgentSessionDetail,
  AgentSessionRecord,
  AgentSessionValidationCheckRecord,
  AgentSessionValidationCheckStatus
} from "@/lib/api";

export function formatDuration(startedAt: number | null, completedAt: number | null): string {
  if (!startedAt) {
    return "-";
  }
  const end = completedAt ?? Date.now();
  const totalSeconds = Math.max(Math.floor((end - startedAt) / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export function excerptText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function latestExecutionStatus(
  latestRun: ActionRunRecord | null,
  latestSession: AgentSessionRecord | null
): ActionRunRecord["status"] | AgentSessionRecord["status"] | null {
  if (latestRun && latestSession) {
    return latestSession.updated_at > latestRun.updated_at
      ? latestSession.status
      : latestRun.status;
  }
  return latestRun?.status ?? latestSession?.status ?? null;
}

export function latestValidationStatus(
  detail: AgentSessionDetail | null,
  latestRun?: ActionRunRecord | null,
  latestSession?: AgentSessionRecord | null
): ActionRunRecord["status"] | AgentSessionRecord["status"] | null {
  const detailStatus = latestExecutionStatus(detail?.linkedRun ?? null, detail?.session ?? null);
  if (detailStatus !== null) {
    return detailStatus;
  }
  return latestExecutionStatus(latestRun ?? null, latestSession ?? null);
}

export function highlightedValidationArtifacts(
  detail: AgentSessionDetail | null
): AgentSessionArtifactRecord[] {
  if (!detail) {
    return [];
  }
  const highlightedIds = new Set(detail.validationSummary.highlighted_artifact_ids);
  if (highlightedIds.size === 0) {
    return detail.artifacts.slice(0, 3);
  }
  const highlighted = detail.artifacts.filter((artifact) => highlightedIds.has(artifact.id));
  if (highlighted.length > 0) {
    return highlighted;
  }
  return detail.artifacts.slice(0, 3);
}

export function validationCheckBadgeVariant(
  status: AgentSessionValidationCheckStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "passed") {
    return "default";
  }
  if (status === "partial") {
    return "secondary";
  }
  if (status === "skipped") {
    return "outline";
  }
  if (status === "failed" || status === "cancelled") {
    return "destructive";
  }
  return "secondary";
}

export function validationCheckStatusLabel(check: AgentSessionValidationCheckRecord): string {
  const label = check.scope ? `${check.label} (${check.scope})` : check.label;
  const statusLabel =
    check.status === "pending"
      ? "running"
      : check.status === "partial"
        ? "partial"
      : check.status === "skipped"
        ? "skipped"
        : check.status;
  return `${label}: ${statusLabel}`;
}
