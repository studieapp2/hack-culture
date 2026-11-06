import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Connect } from '../../pages/Connect';
import { cursorMcpConfiguration } from '../mcpSetup';
import { apiClient } from '../apiClient';

test('Cursor setup uses portable local paths and contains no provider credentials', () => {
  const config = JSON.parse(cursorMcpConfiguration()).mcpServers.patchpilot;
  assert.equal(config.type, 'stdio');
  assert.equal(config.command, 'node');
  assert.deepEqual(config.args, ['${workspaceFolder}/build/mcp/index.js']);
  assert.equal(config.env.DOTENV_CONFIG_PATH, '${workspaceFolder}/.env');
  assert.equal(config.env.TAVILY_API_KEY, undefined);
  assert.equal(config.env.BIFROST_API_KEY, undefined);
});

test('Connect starts with unverified status, not a fabricated successful integration', () => {
  const html = renderToStaticMarkup(<Connect />);
  assert.match(html, /Editor discovery not verified/);
  assert.match(html, /Not checked/);
  assert.match(html, /diagnose_api_error/);
  assert.match(html, /propose_verified_patch/);
  assert.doesNotMatch(html, /Connected successfully/);
});

test('Readiness check uses the no-provider-probe endpoint', async () => {
  const original = globalThis.fetch;
  let endpoint: unknown;
  globalThis.fetch = async url => {
    endpoint = url;
    return new Response(JSON.stringify({ status: 'ready' }));
  };
  try {
    assert.deepEqual(await apiClient.getReadiness(), { status: 'ready' });
    assert.equal(endpoint, '/api/ready');
  } finally { globalThis.fetch = original; }
});

test('Malformed readiness results cannot be displayed as reachable', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'success' }));
  try { await assert.rejects(apiClient.getReadiness(), /invalid readiness/); }
  finally { globalThis.fetch = original; }
});
