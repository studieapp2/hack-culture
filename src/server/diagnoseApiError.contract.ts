import type {
  CodePatch, ExtractedClaim, MeasuredTokenUsage, RunTestResult, VerifiedSource
} from './types';

/** Version 1: shared, recommendation-only contract for the backend and MCP adapter. */
export interface DiagnoseApiErrorInput {
  error: string;
  code: string;
  /** Optional project-relative path. Never read, written, or executed by the engine. */
  fileName?: string;
  language?: string;
}

export type DiagnoseApiErrorErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_CONFIGURATION'
  | 'PROVIDER_ERROR'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'BUDGET_EXCEEDED'
  | 'TIMEOUT'
  | 'INSUFFICIENT_EVIDENCE'
  | 'INTERNAL_ERROR';

export interface DiagnoseApiErrorError {
  code: DiagnoseApiErrorErrorCode;
  message: string;
  provider?: 'bifrost' | 'tavily';
  configuration?: string[];
  retryable: boolean;
}

export interface DiagnoseApiErrorResult {
  contractVersion: '1';
  status: 'supported' | 'insufficient_evidence' | 'error';
  diagnosis: {
    summary: string;
    evidenceStatus: 'supported' | 'unverified';
  } | null;
  claims: ExtractedClaim[];
  /** Only sources actually returned by Tavily; never model-invented citations. */
  sources: VerifiedSource[];
  /** Omitted unless the strict evidence checks support a changed proposal. */
  proposedPatch?: CodePatch;
  tests: RunTestResult[];
  usage: {
    model: MeasuredTokenUsage | null;
    modelCalls: number;
    searchCalls: number;
    extractionCalls: number;
    searchCredits: number | null;
    extractionCredits: number | null;
    /** Invoice cost is unknown unless explicitly reported; never a generic estimate. */
    actualCostUsd: number | null;
    estimatedCostUsd: number | null;
    costBasis: 'no_requests' | 'configured_rates' | 'not_reported';
    incompleteModelUsage: boolean;
  };
  errors: DiagnoseApiErrorError[];
  safety: {
    codeExecuted: false;
    codeModified: false;
    approvalRequiredToApply: true;
  };
}

export type DiagnoseApiError = (
  input: DiagnoseApiErrorInput
) => Promise<DiagnoseApiErrorResult>;
