import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-display transition-all duration-100 ease-in-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-action-primaryBg text-text-inverse shadow-button hover:bg-text-supportingStrong",
        destructive:
          "bg-danger text-danger-foreground shadow-button hover:bg-danger-text",
        outline:
          "border border-border bg-surface-base text-text-primary shadow-container hover:bg-surface-hover",
        secondary:
          "bg-fill-primary text-text-primary shadow-container hover:bg-fill-secondary",
        ghost: "bg-transparent text-text-primary shadow-none hover:bg-surface-glass",
        link: "h-auto rounded-none px-0 py-0 font-sans text-link-sm text-text-primary shadow-none hover:text-text-supportingStrong hover:underline",
      },
      size: {
        default: "h-9 px-4 text-button-lg",
        sm: "h-9 px-[14px] text-button-md",
        lg: "h-10 px-5 text-button-lg",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
