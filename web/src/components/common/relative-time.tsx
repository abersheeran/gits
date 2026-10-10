import { formatDateTime, formatRelativeTime } from "@/lib/format";
export function RelativeTime({
  timestamp,
  fallback = "—"
}: {
  timestamp: number | null;
  fallback?: string;
}) {
  return timestamp === null ? (
    <span>{fallback}</span>
  ) : (
    <time title={formatDateTime(timestamp)} dateTime={new Date(timestamp).toISOString()}>
      {formatRelativeTime(timestamp)}
    </time>
  );
}
