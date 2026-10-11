import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Panel } from "./panel";
import { PageHeader } from "./page-header";
export function GithubTableSkeleton({
  owners = false,
  announce = true
}: {
  owners?: boolean;
  announce?: boolean;
}) {
  return (
    <SkeletonRegion announce={announce}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{owners ? "所有者" : "GitHub 仓库"}</TableHead>
            <TableHead className={owners ? "hidden w-28 md:table-cell" : "hidden md:table-cell"}>
              {owners ? "仓库" : "本地仓库"}
            </TableHead>
            <TableHead
              className={owners ? "hidden w-40 md:table-cell" : "hidden w-44 md:table-cell"}
            >
              状态
            </TableHead>
            <TableHead className="hidden w-28 lg:table-cell">上次同步</TableHead>
            <TableHead className="w-28 text-right md:w-24">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[0, 1, 2].map((index) => (
            <TableRow key={index}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  {owners && <Skeleton className="size-8 shrink-0 rounded-full" />}
                  <Skeleton className="h-4 w-24 max-w-full" />
                </div>
                <div className="mt-2 space-y-2 md:hidden">
                  <Skeleton className="h-3 w-28 max-w-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Skeleton className="h-3 w-16 max-w-full" />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Skeleton className="h-3 w-16" />
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Skeleton className="size-10 md:size-8" />
                  <Skeleton className="size-10 md:size-8" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SkeletonRegion>
  );
}
export function GithubSyncSkeleton({ source = false }: { source?: boolean }) {
  return (
    <SkeletonRegion announce>
      {source && <Skeleton className="mb-4 h-10 w-24 md:h-8" />}
      <PageHeader
        title={
          source ? (
            <span className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-8 w-40" />
            </span>
          ) : (
            "GitHub 同步"
          )
        }
        description={source ? <Skeleton className="h-5 w-48" /> : undefined}
        action={
          <div className="flex gap-2">
            <Skeleton className="h-10 w-36 md:h-9" />
            {source && <Skeleton className="h-10 w-20 md:h-9" />}
          </div>
        }
      />
      {source && (
        <div className="mb-4 flex gap-4 border-b border-border py-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 w-16" />
          ))}
        </div>
      )}
      <Panel
        header={
          source ? undefined : (
            <>
              <div className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="flex">
                <Skeleton className="size-10 md:size-8" />
                <Skeleton className="size-10 md:size-8" />
              </div>
            </>
          )
        }
      >
        <GithubTableSkeleton owners={!source} announce={false} />
        {!source && (
          <div className="px-4 py-3">
            <Skeleton className="h-10 w-24 md:h-8" />
          </div>
        )}
      </Panel>
    </SkeletonRegion>
  );
}
