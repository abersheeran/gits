import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { RepositoryLabelRecord } from "@/lib/api";

function getContrastingTextColor(hexColor: string): string {
  const normalized = hexColor.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#111827" : "#ffffff";
}

type RepositoryLabelChipProps = {
  label: RepositoryLabelRecord;
  className?: string;
};

export function RepositoryLabelChip({ label, className }: RepositoryLabelChipProps) {
  const style: CSSProperties = {
    backgroundColor: label.color,
    color: getContrastingTextColor(label.color),
    borderColor: label.color
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        className
      )}
      style={style}
      title={label.description ?? label.name}
    >
      {label.name}
    </span>
  );
}
