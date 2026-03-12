const LOG_EXCERPT_MAX_CHARS = 4_000;
const LOG_EXCERPT_HEAD_CHARS = 2_400;
const LOG_EXCERPT_TAIL_CHARS = 1_200;
const LOG_EXCERPT_MARKER = "\n\n...[truncated, open full logs for complete output]...\n\n";

export type AgentLogArtifactKind = "session_logs" | "stdout" | "stderr";

export function buildLogExcerpt(value: string, maxChars = LOG_EXCERPT_MAX_CHARS): string {
  if (value.length <= maxChars) {
    return value;
  }
  const head = value.slice(0, Math.min(LOG_EXCERPT_HEAD_CHARS, maxChars));
  const remaining = Math.max(maxChars - head.length - LOG_EXCERPT_MARKER.length, 0);
  const tailLength = Math.min(LOG_EXCERPT_TAIL_CHARS, remaining);
  if (tailLength === 0) {
    return `${head.slice(0, maxChars - LOG_EXCERPT_MARKER.length)}${LOG_EXCERPT_MARKER}`;
  }
  return `${head}${LOG_EXCERPT_MARKER}${value.slice(-tailLength)}`;
}

export class ActionLogStorageService {
  constructor(private readonly bucket: R2Bucket) {}

  private canRead(): boolean {
    return typeof this.bucket?.get === "function";
  }

  private canWrite(): boolean {
    return typeof this.bucket?.put === "function";
  }

  buildSessionLogKey(repositoryId: string, sessionId: string): string {
    return `repositories/${repositoryId}/sessions/${sessionId}/full.log`;
  }

  buildSessionArtifactLogKey(
    repositoryId: string,
    sessionId: string,
    kind: AgentLogArtifactKind
  ): string {
    return `repositories/${repositoryId}/sessions/${sessionId}/artifacts/${kind}.log`;
  }

  buildAttemptArtifactLogKey(
    repositoryId: string,
    sessionId: string,
    attemptId: string,
    kind: AgentLogArtifactKind
  ): string {
    return `repositories/${repositoryId}/sessions/${sessionId}/attempts/${attemptId}/artifacts/${kind}.log`;
  }

  buildRunLogKey(repositoryId: string, runId: string): string {
    return this.buildSessionLogKey(repositoryId, runId);
  }

  async writeSessionLogs(repositoryId: string, sessionId: string, content: string): Promise<void> {
    if (!this.canWrite()) {
      return;
    }
    await this.bucket.put(this.buildSessionLogKey(repositoryId, sessionId), content);
  }

  async readSessionLogs(repositoryId: string, sessionId: string): Promise<string | null> {
    if (!this.canRead()) {
      return null;
    }
    const object = await this.bucket.get(this.buildSessionLogKey(repositoryId, sessionId));
    return object ? object.text() : null;
  }

  async writeRunLogs(repositoryId: string, runId: string, content: string): Promise<void> {
    await this.writeSessionLogs(repositoryId, runId, content);
  }

  async readRunLogs(repositoryId: string, runId: string): Promise<string | null> {
    return this.readSessionLogs(repositoryId, runId);
  }

  async writeSessionArtifactLogs(
    repositoryId: string,
    sessionId: string,
    kind: AgentLogArtifactKind,
    content: string
  ): Promise<void> {
    if (!this.canWrite()) {
      return;
    }
    await this.bucket.put(this.buildSessionArtifactLogKey(repositoryId, sessionId, kind), content);
  }

  async readSessionArtifactLogs(
    repositoryId: string,
    sessionId: string,
    kind: AgentLogArtifactKind
  ): Promise<string | null> {
    if (!this.canRead()) {
      return null;
    }
    const object = await this.bucket.get(
      this.buildSessionArtifactLogKey(repositoryId, sessionId, kind)
    );
    return object ? object.text() : null;
  }

  async writeAttemptArtifactLogs(
    repositoryId: string,
    sessionId: string,
    attemptId: string,
    kind: AgentLogArtifactKind,
    content: string
  ): Promise<void> {
    if (!this.canWrite()) {
      return;
    }
    await this.bucket.put(
      this.buildAttemptArtifactLogKey(repositoryId, sessionId, attemptId, kind),
      content
    );
  }

  async readAttemptArtifactLogs(
    repositoryId: string,
    sessionId: string,
    attemptId: string,
    kind: AgentLogArtifactKind
  ): Promise<string | null> {
    if (!this.canRead()) {
      return null;
    }
    const object = await this.bucket.get(
      this.buildAttemptArtifactLogKey(repositoryId, sessionId, attemptId, kind)
    );
    return object ? object.text() : null;
  }
}
