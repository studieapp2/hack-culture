import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleGenAI } from '@google/genai';
import { SAMPLE_CODE_INPUT, SAMPLE_ERROR_INPUT, SAMPLE_ANSWER_INPUT } from '../../data/sdkSample';
import { containsCredentialLiteral } from '../inputSafety';

test('Runtime SDK sample uses environment references and provides inputs only', () => {
  assert.equal(containsCredentialLiteral(SAMPLE_CODE_INPUT), false);
  assert.match(SAMPLE_CODE_INPUT, /@google\/genai/);
  assert.match(SAMPLE_CODE_INPUT, /process\.env\.GEMINI_API_KEY/);
  assert.match(SAMPLE_ERROR_INPUT, /generateText is not a function/);
  assert.match(SAMPLE_ANSWER_INPUT, /GoogleGenAI\.generateText/);
});

test('The example method fails on the actual installed SDK without making an API request', () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected network request'); };
  try {
    const client = new GoogleGenAI({ apiKey: 'fixture-only-no-network' });
    assert.throws(() => (client as unknown as {
      generateText: (input: { prompt: string }) => unknown;
    }).generateText({ prompt: 'Controlled test only' }), /generateText is not a function/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});
