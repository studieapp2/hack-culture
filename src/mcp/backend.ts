import { access } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import type { DiagnosisInput, VerificationInput } from './schema';

export type DiagnoseEngine = (input: DiagnosisInput) => Promise<unknown>;
export type VerifyEngine = (input: VerificationInput) => Promise<unknown>;

export class BackendUnavailable extends Error {}
export class InvalidVerificationInput extends Error {}

function backendModuleUrl(): URL {
  const configured = process.env.PATCHPILOT_ENGINE_MODULE;
  if (configured && !isAbsolute(configured))
    throw new BackendUnavailable('Engine module must be a local absolute path.');
  return configured ? pathToFileURL(configured)
    : new URL('../../src/server/services/diagnoseApiError.ts', import.meta.url);
}

async function loadBackend() {
  const moduleUrl = backendModuleUrl();
  try { await access(moduleUrl); }
  catch { throw new BackendUnavailable('Published strict backend module is not present in this checkout.'); }
  return tsImport(moduleUrl.href, import.meta.url);
}

/**
 * Exact published strict entrypoint: services/diagnoseApiError.ts.
 * Optional absolute path is trusted startup configuration, never a tool input.
 * Allows separate workstreams to test together without merging backend files.
 * No fallback to analyzeAndFix, REST URLs or fabricated responses.
 */
export const diagnoseWithBackend: DiagnoseEngine = async input => {
  const backend = await loadBackend();
  const entrypoint = backend.diagnoseApiError;
  if (typeof entrypoint !== 'function') {
    throw new BackendUnavailable('The agreed diagnoseApiError entrypoint is not yet exported.');
  }
  return entrypoint(input);
};

/** Reuse POST /api/verify; never duplicate extraction, research or evaluation. */
export const verifyWithBackend: VerifyEngine = async input => {
  await loadBackend(); // Loads the existing server configuration, without model calls.
  let security;
  try { security = await tsImport(new URL('./sensitiveData.ts', backendModuleUrl()).href, import.meta.url); }
  catch { throw new BackendUnavailable('The backend input-safety module is unavailable.'); }
  if (security.containsCredentials(input.text)) {
    throw new InvalidVerificationInput('Remove credentials before submitting technical text.');
  }
  let url: URL;
  try {
    const base = process.env.PATCHPILOT_API_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || '3000'}/api`;
    url = new URL(base.replace(/\/+$/, '') + '/verify');
  } catch { throw new BackendUnavailable('Local backend API URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new BackendUnavailable('Only the local backend API is supported by this stdio integration.');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.PATCHPILOT_API_TOKEN)
    headers.Authorization = `Bearer ${process.env.PATCHPILOT_API_TOKEN}`;
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
  } catch { throw new BackendUnavailable('The local backend API cannot be reached.'); }
  if (!response.ok) throw new Error('Backend verification request failed; check Runs before retrying.');
  return response.json();
};
