import { useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

type CopyButtonProps = {
  value: string;
  idleLabel?: string;
  copiedLabel?: string;
  failedLabel?: string;
  onCopied?: () => void;
  onFailed?: () => void;
} & Omit<ButtonProps, "onClick">;

function copyByExecCommand(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return ok;
}

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to legacy path.
    }
  }

  return copyByExecCommand(value);
}

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
  const [state, setState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleClick() {
    const ok = await copyText(value);

    if (ok) {
      setState("copied");
      onCopied?.();
    } else {
      setState("failed");
      onFailed?.();
    }

    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setState("idle");
    }, ok ? 1400 : 2000);
  }

  const label = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : idleLabel;

  return (
    <Button
      type="button"
      variant={state === "failed" ? "destructive" : variant}
      size={size}
      aria-live="polite"
      onClick={handleClick}
      {...props}
    >
      {label}
    </Button>
  );
}
