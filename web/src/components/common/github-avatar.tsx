import { useState } from "react";
import { AuthorAvatar } from "@/components/repository/author-avatar";
export function GithubAvatar({ login, url }: { login: string; url: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return url && failedUrl !== url ? (
    <img
      src={url}
      alt=""
      className="size-8 shrink-0 rounded-full"
      onError={() => setFailedUrl(url)}
    />
  ) : (
    <AuthorAvatar name={login} />
  );
}
