import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Variant = "login" | "register" | "repository" | "settings";
type Field = { name: string; multiline?: boolean; prefix?: boolean; description?: boolean };
type Layout = { fields: Field[]; visibility: boolean; actions: string[]; alignEnd?: boolean };

const layouts: Record<Variant, Layout> = {
  login: {
    fields: [{ name: "account" }, { name: "password" }],
    visibility: false,
    actions: ["w-full"]
  },
  register: {
    fields: [{ name: "username" }, { name: "email" }, { name: "password", description: true }],
    visibility: false,
    actions: ["w-full"]
  },
  repository: {
    fields: [{ name: "name", prefix: true }, { name: "description", multiline: true }],
    visibility: true,
    actions: ["w-16", "w-24"],
    alignEnd: true
  },
  settings: {
    fields: [{ name: "name" }, { name: "description", multiline: true }],
    visibility: false,
    actions: ["w-16"]
  }
};

function VisibilitySkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-16" />
      </div>
      {[0, 1].map((index) => (
        <div key={index} className="flex h-9 items-center gap-3">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="size-4 rounded-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-12" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-40 max-w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({ variant }: { variant: Variant }) {
  const layout = layouts[variant];
  return (
    <SkeletonRegion announce>
      <div className="space-y-4 p-4">
        {layout.fields.map((field) => (
          <div key={field.name} className="space-y-2">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-16" />
            </div>
            <div className="flex min-w-0 items-center gap-2">
              {field.prefix && <Skeleton className="h-3.5 w-16 shrink-0" />}
              <Skeleton className={cn("flex-1", field.multiline ? "h-[86px]" : "h-10 md:h-9")} />
            </div>
            {field.description && (
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-24" />
              </div>
            )}
          </div>
        ))}
        {layout.visibility && <VisibilitySkeleton />}
        <div className={cn("flex gap-2", layout.alignEnd && "justify-end")}>
          {layout.actions.map((width) => (
            <Skeleton key={width} className={cn("h-10 md:h-9", width)} />
          ))}
        </div>
      </div>
      {variant === "settings" && (
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle p-4">
          <div className="space-y-2">
            <div className="flex h-5 items-center"><Skeleton className="h-3.5 w-16" /></div>
            <div className="flex h-5 items-center gap-2">
              <Skeleton className="size-4 rounded-sm" />
              <Skeleton className="h-3.5 w-8" />
            </div>
          </div>
          <Skeleton className="size-10 rounded-md md:size-8" />
        </div>
      )}
    </SkeletonRegion>
  );
}
