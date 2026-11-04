export type RunState =
  | 'QUEUED'
  | 'ANALYZING'
  | 'VERIFYING'
  | 'PATCH_READY'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'FAILED'
  | 'COMPLETED';

export type RunType = 'code_fix' | 'answer_verification';

export type ClaimVerificationStatus =
  | 'VERIFIED'
  | 'OUTDATED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'UNCHECKABLE'
  | 'ERROR';

export interface VerifiedSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string;
  retrievedAt: string;
  excerpt: string;
  score?: number;
  extractionStatus?: 'extracted' | 'not_extracted';
}

export interface ExtractedClaim {
  id: string;
  originalText: string;
  startOffset: number;
  endOffset: number;
  topic?: string;
  freshnessSensitive: boolean;
  status: ClaimVerificationStatus;
  explanation: string;
  sources: VerifiedSource[];
  suggestedCorrection?: string;
  supportingSourceUrls?: string[];
}

export interface CodePatch {
  id: string;
  filePath: string;
  originalCode: string;
  proposedCode: string;
  unifiedDiff: string;
  explanation: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
}

export interface RunTestResult {
  id: string;
  name: string;
  status: 'not_run' | 'passed' | 'failed' | 'skipped';
  output: string;
  reason: string;
}

export interface MeasuredTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  currency: 'USD';
  isMeasured: boolean;
  model: string;
  provider?: string;
  latencyMs: number;
  fallbackUsed?: boolean;
  fallbackModel?: string;
  usageReported?: boolean;
  requestedModel?: string;
  costBasis?: 'configured_rates' | 'generic_estimate' | 'mixed';
}

export interface WorkflowProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  description?: string;
  timestamp?: string;
}

export interface ServerRun {
  id: string;
  title: string;
  type: RunType;
  status: RunState;
  createdAt: string;
  updatedAt: string;
  errorInput?: string;
  codeInput?: string;
  fileName?: string;
  answerInput?: string;
  diagnosis?: string;
  steps: WorkflowProgressStep[];
  claims: ExtractedClaim[];
  patch?: CodePatch;
  tests: RunTestResult[];
  usage: MeasuredTokenUsage;
  errorMessage?: string;
}
