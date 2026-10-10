import { cn } from "@/lib/utils";
import { CopyIconButton } from "./copy-icon-button";

export function CopyField({
  value,
  label,
  className
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 md:h-9 min-w-0 items-center rounded-md border border-border bg-surface-base has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring",
        className
      )}
    >
      <input
        readOnly
        value={value}
        title={value}
        aria-label={label}
        onClick={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 truncate bg-transparent px-3 font-mono text-[13px] text-text-secondary focus-visible:outline-none"
      />
      <CopyIconButton
        value={value}
        label={`复制${label}`}
        className="h-full shrink-0 rounded-l-none border-l border-border md:h-full"
      />
    </div>
  );
}
