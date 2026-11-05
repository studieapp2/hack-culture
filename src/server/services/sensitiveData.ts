import { serverConfig } from '../config';

const tokenPattern = /\b(?:(?:sk-|tvly-)[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g;
const literalPattern = /\b(?:api[_-]?key|access[_-]?token|authorization|password)\s*[:=]\s*(['"`])([^'"`\r\n]+)\1/gi;
const placeholder = /^(?:YOUR[_A-Z0-9]*|REPLACE[_A-Z0-9]*|<[^>]+>|\[redacted\]|placeholder|example|test)$/i;
const bearerPattern = /\bBearer\s+([A-Za-z0-9_.-]{8,})/gi;
const signedValuePattern = /[?&](?:api[_-]?key|access[_-]?token|token|signature|X-Amz-Credential|X-Amz-Signature|X-Goog-Signature|sig)=([^&\s#"'`]+)/gi;

export function containsCredentials(text: string): boolean {
  const known = [serverConfig.tavilyApiKey, serverConfig.bifrostApiKey]
    .filter((value): value is string => Boolean(value));
  if (known.some((value) => text.includes(value))) return true;
  tokenPattern.lastIndex = 0;
  if (tokenPattern.test(text)) return true;
  for (const pattern of [bearerPattern, signedValuePattern]) {
    pattern.lastIndex = 0;
    let value: RegExpExecArray | null;
    while ((value = pattern.exec(text))) {
      if (!placeholder.test(value[1]) && !/^(?:authentication|authorization|credentials?)$/i.test(value[1])) return true;
    }
  }
  literalPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = literalPattern.exec(text))) {
    const value = match[2].replace(/^Bearer\s+/i, '').trim();
    if (value && !placeholder.test(value) && !value.includes('${')) return true;
  }
  return false;
}

export function redactProviderSecrets(text: string): string {
  for (const value of [serverConfig.tavilyApiKey, serverConfig.bifrostApiKey]) {
    if (value) text = text.split(value).join('[redacted]');
  }
  text = text.replace(tokenPattern, '[redacted]');
  text = text.replace(bearerPattern, (match, value: string) =>
    placeholder.test(value) || /^(?:authentication|authorization|credentials?)$/i.test(value)
      ? match : 'Bearer [redacted]');
  return text.replace(signedValuePattern, (match, value: string) =>
    placeholder.test(value) ? match : `${match.slice(0, match.indexOf('=') + 1)}[redacted]`);
}
