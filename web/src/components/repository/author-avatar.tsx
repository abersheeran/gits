import { cn } from "@/lib/utils";

function authorInitial(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    return "?";
  }
  return normalized.slice(0, 1).toUpperCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function authorAvatarStyle(name: string): { backgroundColor: string; color: string } {
  const hue = hashString(name) % 360;
  return {
    backgroundColor: `hsl(${hue} 70% 92%)`,
    color: `hsl(${hue} 46% 30%)`
  };
}

type AuthorAvatarProps = {
  name: string;
  className?: string;
  textClassName?: string;
};

export function AuthorAvatar({ name, className, textClassName }: AuthorAvatarProps) {
  return (
    <div
      className={cn(
        "grid h-8 w-8 shrink-0 place-content-center rounded-full text-xs font-semibold",
        className
      )}
      style={authorAvatarStyle(name)}
      aria-hidden
    >
      <span className={textClassName}>{authorInitial(name)}</span>
    </div>
  );
}
