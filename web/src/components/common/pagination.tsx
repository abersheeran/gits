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
    <nav aria-label="分页" className="flex items-center justify-end gap-2 p-4">
      <Button variant="outline" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </Button>
      <span className="text-body-micro text-text-tertiary">第 {page} 页</span>
      <Button variant="outline" disabled={disabled || !hasNext} onClick={() => onChange(page + 1)}>
        下一页
      </Button>
    </nav>
  );
}
