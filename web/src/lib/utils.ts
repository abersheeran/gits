import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "text-color": [
        "text-foreground",
        "text-primary",
        "text-primary-foreground",
        "text-secondary-foreground",
        "text-muted-foreground",
        "text-accent-foreground",
        "text-card-foreground",
        "text-popover-foreground",
        "text-destructive",
        "text-destructive-foreground",
        "text-danger-text",
        "text-text-primary",
        "text-text-secondary",
        "text-text-tertiary",
        "text-text-supporting",
        "text-text-supportingStrong",
        "text-text-inverse",
      ],
      "font-size": [
        "text-hero-display",
        "text-section-heading",
        "text-section-heading-mobile",
        "text-card-heading-mobile",
        "text-card-title",
        "text-heading-3-16",
        "text-heading-3-16-semibold",
        "text-heading-3-15",
        "text-heading-4",
        "text-button-lg",
        "text-button-md",
        "text-button-sm",
        "text-body-md",
        "text-body-sm",
        "text-body-xs",
        "text-body-micro",
        "text-body-tiny",
        "text-label-md",
        "text-label-sm",
        "text-label-xs",
        "text-label-xs-tight",
        "text-item-compact",
        "text-link-sm",
        "text-link-md",
        "text-link-underline",
        "text-code-sm",
        "text-blog-heading-1",
        "text-blog-heading-2",
        "text-blog-heading-3",
        "text-blog-heading-4",
        "text-blog-content",
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
