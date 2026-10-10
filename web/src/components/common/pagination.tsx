import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
export function Pagination({
  page,
  hasNext,
  onChange,
  disabled
}: {
  page: number;
  hasNext: boolean;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  if (page <= 1 && !hasNext) return null;

  return (
    <nav
      aria-label="分页"
      className="flex items-center justify-between border-t border-border-subtle px-4 py-3"
    >
      <span className="text-body-micro text-text-tertiary">第 {page} 页</span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          上一页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !hasNext}
          onClick={() => onChange(page + 1)}
        >
          下一页
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
