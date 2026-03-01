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

const relativeTimeFormatter = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "auto"
});

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1]
];

export function formatRelativeTime(
  timestamp: number | null | undefined,
  now = Date.now()
): string {
  if (!timestamp) {
    return "-";
  }

  const deltaSeconds = Math.round((timestamp - now) / 1000);
  const absoluteDelta = Math.abs(deltaSeconds);

  for (const [unit, secondsPerUnit] of RELATIVE_UNITS) {
    if (absoluteDelta >= secondsPerUnit || unit === "second") {
      const value = Math.round(deltaSeconds / secondsPerUnit);
      return relativeTimeFormatter.format(value, unit);
    }
  }

  return "-";
}
