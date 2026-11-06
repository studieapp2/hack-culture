/** Client preflight only; it never replaces server-side validation. */
export function containsCredentialLiteral(text: string): boolean {
  if (/\b(?:sk-[A-Za-z0-9_-]{12,}|tvly-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{25,})\b/.test(text) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(text)) return true;
  const assignments = text.matchAll(/\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["']([^"'\r\n]{8,})["']/gi);
  for (const [, value] of assignments) {
    if (!/^(?:YOUR_[A-Z_]+|env\.[A-Z_]+|\[REDACTED\]|<[^>]+>)$/.test(value)) return true;
  }
  return /[?&](?:access_token|api_key|token|x-amz-signature|x-goog-signature)=[^\s&#"']{8,}/i.test(text);
}

export function assertSafeSubmission(...values: string[]): void {
  if (values.some(containsCredentialLiteral)) {
    throw new Error('Remove credential literals before submitting. Use environment references instead; no request was sent.');
  }
}

export function safeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    for (const name of url.searchParams.keys())
      if (/^(?:access_token|api_key|apikey|token|x-amz-signature|x-goog-signature)$/i.test(name)) return undefined;
    return value;
  } catch { return undefined; }
}
