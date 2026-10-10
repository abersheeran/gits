import { cn } from "@/lib/utils";

export function AuthorAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        "grid h-8 w-8 shrink-0 place-content-center rounded-full bg-fill-primary text-body-micro font-semibold text-text-secondary",
        className
      )}
      aria-hidden
    >
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </div>
  );
}
