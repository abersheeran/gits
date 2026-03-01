export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function shortOid(oid: string, length = 12): string {
  return oid.slice(0, length);
}
