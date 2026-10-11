import { formatGithubApiError as formatApiError } from "@/lib/api-error";
import { githubErrorMessage } from "@/lib/github-errors";
import { useState } from "react";
import { Panel } from "./panel";
import { GithubStatusBadge } from "./github-status-badge";
import { RelativeTime } from "./relative-time";
import { ErrorAlert } from "./error-alert";
import { ConfirmDialog } from "./confirm-dialog";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { getRepositoryDetail, type RepositoryDetailResponse } from "@/lib/api";
import {
  stopRepositoryMirror,
  syncRepositoryMirror,
  type RepositoryMirror
} from "@/lib/github-api";
export function RepositoryMirrorPanel({
  owner,
  repo,
  mirror,
  onSaved
}: {
  owner: string;
  repo: string;
  mirror: RepositoryMirror;
  onSaved: (detail: RepositoryDetailResponse) => void;
}) {
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Panel header="同步">
        <ErrorAlert inset error={error ?? githubErrorMessage(mirror.lastError)} />
        <div className="space-y-4 p-4">
          <dl className="space-y-3 text-body-xs">
            <div>
              <dt className="text-text-secondary">来源</dt>
              <dd className="mt-1">
                <a
                  className="gh-link break-all"
                  href={mirror.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {mirror.fullName}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary">状态</dt>
              <dd className="mt-1">
                <GithubStatusBadge status={mirror.state} error={mirror.lastError} />
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary">上次同步</dt>
              <dd className="mt-1">
                <RelativeTime timestamp={mirror.lastSyncedAt} />
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <PendingButton
              pending={pending}
              pendingText="同步中…"
              onClick={async () => {
                setPending(true);
                setError(null);
                try {
                  await syncRepositoryMirror(owner, repo);
                  onSaved(await getRepositoryDetail(owner, repo));
                } catch (cause) {
                  setError(formatApiError(cause));
                } finally {
                  setPending(false);
                }
              }}
            >
              立即同步
            </PendingButton>
            <Button
              variant="destructiveOutline"
              disabled={pending}
              onClick={() => setStopping(true)}
            >
              停止同步
            </Button>
          </div>
        </div>
      </Panel>
      <ConfirmDialog
        open={stopping}
        onOpenChange={setStopping}
        title="停止同步"
        description="停止同步后，仓库会保留并恢复可写。"
        onConfirm={async () => {
          await stopRepositoryMirror(owner, repo);
          onSaved(await getRepositoryDetail(owner, repo));
        }}
      />
    </>
  );
}
