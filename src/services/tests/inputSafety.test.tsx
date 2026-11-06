import assert from 'node:assert/strict';
import test from 'node:test';
import { apiClient } from '../apiClient';
import { containsCredentialLiteral, safeSourceUrl } from '../inputSafety';

test('Credential literals are rejected before API requests, without echoing the value', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  const credential = 'sk-' + 'fixtureOnly'.repeat(4);
  try {
    await assert.rejects(apiClient.startFixRun({ error: 'SDK error', code: `const apiKey = "${credential}";` }),
      error => error instanceof Error && /no request was sent/.test(error.message) && !error.message.includes(credential));
    await assert.rejects(apiClient.verifyAnswer({ text: 'Authorization: Bearer ' + 'fixtureOnly'.repeat(4) }),
      /Remove credential literals/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('Environment references and obvious documentation placeholders are allowed', () => {
  assert.equal(containsCredentialLiteral('const apiKey = process.env.OPENAI_API_KEY;'), false);
  assert.equal(containsCredentialLiteral('api_key: "YOUR_API_KEY"'), false);
  assert.equal(containsCredentialLiteral('api_key: "env.OPENAI_API_KEY"'), false);
});

test('Citation URLs reject executable schemes, embedded credentials and signed tokens', () => {
  assert.equal(safeSourceUrl('javascript:alert(1)'), undefined);
  assert.equal(safeSourceUrl('data:text/html,test'), undefined);
  assert.equal(safeSourceUrl('https://user:fixture-password@example.com/docs'), undefined);
  assert.equal(safeSourceUrl('https://example.com/docs?access_token=fixture-token'), undefined);
  assert.equal(safeSourceUrl('https://example.com/docs?version=2#method'),
    'https://example.com/docs?version=2#method');
});

test('Claims without safe evidence links cannot appear verified or outdated', async () => {
  const original = globalThis.fetch;
  const run = {
    id: 'unsafe-source-fixture', title: 'Fixture', type: 'answer_verification', status: 'COMPLETED',
    createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z',
    steps: [], tests: [], claims: [
      { id: 'c', originalText: 'Fixture claim', status: 'VERIFIED', sources: [
        { id: 's', title: 'Fixture', url: 'javascript:alert(1)', excerpt: 'Fixture', publisher: 'Fixture' },
      ] },
      { id: 'd', originalText: 'Fixture claim', status: 'OUTDATED', sources: [] },
    ],
  };
  globalThis.fetch = async () => new Response(JSON.stringify([run]));
  try {
    const result = (await apiClient.listRuns())[0];
    assert.equal(result.claims[0].status, 'uncertain');
    assert.equal(result.claims[0].sources[0].url, undefined);
    assert.equal(result.claims[1].status, 'uncertain');
  } finally { globalThis.fetch = original; }
});
