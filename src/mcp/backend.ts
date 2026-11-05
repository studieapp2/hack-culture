import { access } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import type { DiagnosisInput } from './schema';

export type DiagnoseEngine = (input: DiagnosisInput) => Promise<unknown>;

export class BackendUnavailable extends Error {}

/**
 * Exact published strict entrypoint: services/diagnoseApiError.ts.
 * Optional absolute path is trusted startup configuration, never a tool input.
 * Allows separate workstreams to test together without merging backend files.
 * No fallback to analyzeAndFix, REST URLs or fabricated responses.
 */
export const diagnoseWithBackend: DiagnoseEngine = async input => {
  const configured = process.env.PATCHPILOT_ENGINE_MODULE;
  if (configured && !isAbsolute(configured))
    throw new BackendUnavailable('Engine module must be a local absolute path.');
  const moduleUrl = configured ? pathToFileURL(configured)
    : new URL('../../src/server/services/diagnoseApiError.ts', import.meta.url);
  try { await access(moduleUrl); }
  catch { throw new BackendUnavailable('Published strict backend module is not present in this checkout.'); }
  const backend = await tsImport(moduleUrl.href, import.meta.url);
  const entrypoint = backend.diagnoseApiError;
  if (typeof entrypoint !== 'function') {
    throw new BackendUnavailable('The agreed diagnoseApiError entrypoint is not yet exported.');
  }
  return entrypoint(input);
};
