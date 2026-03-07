const REDACTED_SECRET = "[REDACTED]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectSecretVariants(secret: string): string[] {
  const trimmed = secret.trim();
  if (!trimmed) {
    return [];
  }

  const variants = new Set<string>([trimmed]);
  const encoded = encodeURIComponent(trimmed);
  if (encoded && encoded !== trimmed) {
    variants.add(encoded);
  }

  return [...variants];
}

export function createSecretRedactor(
  secrets: Array<string | null | undefined> = []
): (input: string) => string {
  const secretPatterns = [...new Set(secrets.flatMap((secret) => collectSecretVariants(secret ?? "")))]
    .sort((left, right) => right.length - left.length)
    .map((secret) => new RegExp(escapeRegExp(secret), "g"));

  return (input: string): string => {
    let output = input;

    for (const pattern of secretPatterns) {
      output = output.replace(pattern, REDACTED_SECRET);
    }

    output = output.replace(/\bgts_[A-Za-z0-9_-]{16,}\b/g, REDACTED_SECRET);
    output = output.replace(/\b(Bearer)\s+[^\s"'`]+/gi, `$1 ${REDACTED_SECRET}`);
    output = output.replace(
      /([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s/]+)(@)/gi,
      `$1${REDACTED_SECRET}$3`
    );

    return output;
  };
}
