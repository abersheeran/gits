import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="mb-4 flex w-fit min-h-10 items-center gap-2 rounded-md text-body-xs text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas md:min-h-8"
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </Link>
  );
}
