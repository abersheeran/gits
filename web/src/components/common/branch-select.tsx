import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import type { RepositoryDetailResponse } from "@/lib/api";
import { selectedBranchName } from "@/lib/repository-navigation";
import { shortOid } from "@/lib/format";
export function BranchSelect({
  detail,
  onChange,
  disabled
}: {
  detail: RepositoryDetailResponse;
  onChange: (ref: string) => void;
  disabled?: boolean;
}) {
  const selected = selectedBranchName(detail.selectedRef) ?? detail.defaultBranch ?? "";
  const branches = detail.branches.map((branch) => selectedBranchName(branch.name) ?? branch.name);
  return (
    <Select value={selected} onValueChange={onChange} disabled={disabled || !selected}>
      <SelectTrigger aria-label="选择分支" className="w-full min-w-0 shrink-0 font-mono text-[13px] md:w-56">
        <SelectValue placeholder="暂无分支" />
      </SelectTrigger>
      <SelectContent>
        {selected && !branches.includes(selected) && (
          <SelectItem value={selected}>
            {/^[a-f0-9]{40}$/i.test(selected) ? shortOid(selected) : selected}
          </SelectItem>
        )}
        {branches.map((branch) => (
          <SelectItem key={branch} value={branch}>
            {branch}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function BranchSelectSkeleton() {
  return (
    <SkeletonRegion className="w-full shrink-0 md:w-56">
      <Skeleton className="h-10 w-full md:h-9" />
    </SkeletonRegion>
  );
}
