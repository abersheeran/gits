import { requestJson } from "./api-request";

export type LoginSession = {
  id: string;
  user_agent: string;
  ip_address: string | null;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  current: boolean;
};
export function listSessions(page: number) {
  return requestJson<{ sessions: LoginSession[]; hasNext: boolean }>(`/api/auth/sessions?page=${page}`);
}
export function revokeSession(id?: string) {
  return requestJson<{ ok: true }>(
    `/api/auth/sessions${id ? `/${encodeURIComponent(id)}` : ""}`, { method: "DELETE" }
  );
}

export function deviceName(agent: string): string {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox"
    : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "未知浏览器";
  const system = /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android"
    : /Windows/.test(agent) ? "Windows" : /Macintosh|Mac OS/.test(agent) ? "macOS"
    : /Linux/.test(agent) ? "Linux" : "未知系统";
  return `${browser} · ${system}`;
}
