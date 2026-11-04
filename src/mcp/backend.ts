import type { FixCodeResult } from '../server/services/fixCodeService';
import type { DiagnosisInput } from './schema';

export type DiagnoseEngine = (input: DiagnosisInput) => Promise<FixCodeResult>;

export class BackendUnavailable extends Error {}

/**
 * Pending Knut's approval: diagnoseApiError(input) exported from fixCodeService.
 * No fallback to analyzeAndFix, REST preview URLs or fabricated responses.
 * Imports no run store; the MCP layer never persists supplied source code.
 */
export const diagnoseWithBackend: DiagnoseEngine = async input => {
  const backend = await import('../server/services/fixCodeService');
  const entrypoint = (backend as unknown as {
    diagnoseApiError?: DiagnoseEngine;
  }).diagnoseApiError;
  if (typeof entrypoint !== 'function') {
    throw new BackendUnavailable('The agreed diagnoseApiError entrypoint is not yet exported.');
  }
  return entrypoint(input);
};
