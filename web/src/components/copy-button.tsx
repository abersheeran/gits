import { useCopy } from "@/hooks/use-copy";
import { Button, type ButtonProps } from "@/components/ui/button";

type CopyButtonProps = {
  value: string;
  idleLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
  onCopied?: () => void;
  onFailed?: () => void;
} & Omit<ButtonProps, "onClick">;

export function CopyButton({
  value,
  idleLabel = "复制",
  copiedLabel = "已复制",
  failedLabel = "复制失败",
  onCopied,
  onFailed,
  variant = "outline",
  size = "sm",
  ...props
}: CopyButtonProps) {
  const { state, copy } = useCopy(value);

  async function handleClick() {
    if (await copy()) onCopied?.();
    else onFailed?.();
  }

  const label = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : idleLabel;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-live="polite"
      onClick={handleClick}
      {...props}
    >
      {label}
    </Button>
  );
}
