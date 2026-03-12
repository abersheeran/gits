import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 font-sans text-label-xs text-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-surface-canvas",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-action-primaryBg text-text-inverse shadow-button",
        secondary: "border-transparent bg-fill-primary text-text-primary",
        destructive: "border-danger-border bg-danger-surface text-danger-text",
        outline: "border-border-subtle bg-surface-base text-text-supporting",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
