import { serverConfig } from '../config';

const tokenPattern = /\b(?:sk-|tvly-)[A-Za-z0-9_-]{8,}\b/g;
const literalPattern = /\b(?:api[_-]?key|access[_-]?token|authorization|password)\s*[:=]\s*(['"`])([^'"`\r\n]+)\1/gi;
const placeholder = /^(?:YOUR[_A-Z0-9]*|REPLACE[_A-Z0-9]*|<[^>]+>|\[redacted\]|placeholder|example|test)$/i;

export function containsCredentials(text: string): boolean {
  const known = [serverConfig.tavilyApiKey, serverConfig.bifrostApiKey]
    .filter((value): value is string => Boolean(value));
  if (known.some((value) => text.includes(value))) return true;
  tokenPattern.lastIndex = 0;
  if (tokenPattern.test(text)) return true;
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
  return text.replace(tokenPattern, '[redacted]');
}
