import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Ban, Monitor } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { Panel } from "@/components/common/panel";
import { ErrorAlert } from "@/components/common/error-alert";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { IconButton } from "@/components/common/icon-button";
import { RelativeTime } from "@/components/common/relative-time";
import { Pagination } from "@/components/common/pagination";
import { TableSkeleton } from "@/components/common/list-skeletons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLoadingSkeleton } from "@/hooks/use-loading-skeleton";
import { formatApiError, type AuthUser } from "@/lib/api";
import { deviceName, listSessions, revokeSession, type LoginSession } from "@/lib/session-api";

export function SessionsPage({ user }: { user: AuthUser | null }) {
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<LoginSession | "others" | null>(null);
  const [revision, setRevision] = useState(0);
  const showSkeleton = useLoadingSkeleton(loading, sessions.length > 0);
  useEffect(() => {
    if (!user) return;
    let canceled = false;
    listSessions(page).then((data) => {
      if (canceled) return;
      if (!data.sessions.length && page > 1) {
        setPage(page - 1);
        return;
      }
      setSessions(data.sessions);
      setHasNext(data.hasNext);
      setError(null);
      setLoading(false);
    }).catch((cause) => {
      if (!canceled) { setError(formatApiError(cause)); setLoading(false); }
    });
    return () => { canceled = true; };
  }, [user, page, revision]);
  if (!user) return <Navigate to="/login" replace />;
  const hasOthers = sessions.some((session) => !session.current) || hasNext;
  return (
    <>
      <PageHeader title="登录设备" action={
        <Button variant="destructiveOutline" disabled={loading || !hasOthers}
          onClick={() => setTarget("others")}>退出其他设备</Button>
      } />
      <Panel>
        <ErrorAlert inset error={error} />
        {showSkeleton ? <TableSkeleton variant="sessions" /> : sessions.length === 0 ? (
          <EmptyState icon={Monitor} title="没有可用的登录设备" description="请重新登录后查看。" />
        ) : (
          <Table className="table-fixed">
            <TableHeader><TableRow>
              <TableHead>设备</TableHead>
              <TableHead className="hidden md:table-cell">登录时间</TableHead>
              <TableHead className="hidden lg:table-cell">最近活动</TableHead>
              <TableHead className="w-24">状态</TableHead>
              <TableHead className="w-16"><span className="sr-only">操作</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>{sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>
                  <span className="block truncate" title={session.user_agent}>{deviceName(session.user_agent)}</span>
                  <span className="mt-1 block truncate text-body-micro text-text-tertiary">
                    {session.ip_address || "未知 IP"}
                  </span>
                  <span className="mt-1 block text-body-micro text-text-tertiary lg:hidden">
                    最近活动：<RelativeTime timestamp={session.last_used_at} />
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell"><RelativeTime timestamp={session.created_at} /></TableCell>
                <TableCell className="hidden lg:table-cell"><RelativeTime timestamp={session.last_used_at} /></TableCell>
                <TableCell>{session.current ? <Badge variant="outline">当前设备</Badge> :
                  <span className="text-text-secondary">已登录</span>}</TableCell>
                <TableCell>{!session.current && (
                  <IconButton label={`退出 ${deviceName(session.user_agent)}`} disabled={loading}
                    onClick={() => setTarget(session)}><Ban className="h-4 w-4" /></IconButton>
                )}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
        <Pagination page={page} hasNext={hasNext} disabled={loading} onChange={(nextPage) => { setLoading(true); setPage(nextPage); }} />
      </Panel>
      <ConfirmDialog open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }}
        title={target === "others" ? "退出其他设备" : "退出设备"}
        description={target === "others" ? "其他设备需要重新登录才能继续访问，你的当前登录会保留。" :
          `退出 ${target ? deviceName(target.user_agent) : "该设备"} 后，该设备需要重新登录才能继续访问。`}
        onConfirm={async () => {
          if (!target) return;
          await revokeSession(target === "others" ? undefined : target.id);
          setLoading(true);
          setRevision((value) => value + 1);
        }} />
    </>
  );
}
