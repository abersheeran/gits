import * as React from "react"
import { LoaderCircle } from "lucide-react"

import { Button, type ButtonProps } from "@/components/ui/button"

type PendingButtonProps = ButtonProps & {
  pending?: boolean
  pendingText?: React.ReactNode
}

export function PendingButton({
  pending = false,
  pendingText,
  disabled,
  children,
  ...props
}: PendingButtonProps) {
  return (
    <Button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-live="polite"
    >
      {pending ? <LoaderCircle className="animate-spin" /> : null}
      <span>{pending ? pendingText ?? children : children}</span>
    </Button>
  )
}
