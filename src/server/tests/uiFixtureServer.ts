// Isolated browser-test backend. Never use for a public deployment.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'patchpilot-ui-fixture-'));
process.env.PATCHPILOT_DATA_DIR = dataDir;
process.env.NODE_ENV = 'production';
const { serverConfig } = await import('../config');
serverConfig.bifrostBaseUrl = 'https://fixture.invalid/v1';
serverConfig.tavilyApiKey = 'test-fixture-not-a-real-key';
globalThis.fetch = (async (url, options) => {
  const json = (data: unknown) => new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
  if (String(url).endsWith('/models')) return json({ data: [{ id: 'fixture-model' }] });
  if (String(url).startsWith('https://api.tavily.com/search')) return json({ results: [{
    title: 'Browser test fixture source', url: 'https://example.com',
    content: 'This is fixture evidence for isolated tests, not a live citation.'
  }] });
  if (!String(url).startsWith('https://fixture.invalid/')) {
    throw new Error('External provider calls are forbidden in the browser fixture server.');
  }
  const body = JSON.parse(String(options?.body));
  const system = body.messages[0].content as string;
  const user = body.messages[1].content as string;
  let result: unknown;
  if (system.includes('claim extraction')) {
    result = { claims: [{ exact_quote: user.trim(), freshness_sensitive: true }] };
  } else if (system.includes('coding diagnostic') || system.includes('Generate a minimal patch')) {
    const code = (user.split(/CODE \([^\n]+\):\n/)[1] || '').split('\n\nDIAGNOSIS:')[0];
    result = {
      diagnosis: 'Browser test fixture diagnosis; no live AI was called.',
      technical_claims: ['The fixture API supports this feature.'],
      proposed_code: code ? `${code}\n// browser test fixture patch\n` : '',
      explanation: 'Isolated browser test fixture, not an AI-generated fix.'
    };
  } else {
    result = { status: 'VERIFIED', explanation: 'Isolated test fixture evaluation, not a live verification.' };
  }
  return json({ choices: [{ message: { content: JSON.stringify(result) } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }, model: 'fixture-model' });
}) as typeof fetch;
const { createApp } = await import('../../../server');
const { httpServer } = await createApp();
httpServer.listen(3400, '127.0.0.1', () => {
  console.log('TEST FIXTURES ONLY: http://127.0.0.1:3400 (not publicly exposed)');
});
const stop = () => httpServer.close(() => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
