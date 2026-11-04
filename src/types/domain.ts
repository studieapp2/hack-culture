/**
 * PatchPilot Core Domain Types
 */

export type RunType = 'code_fix' | 'answer_verification';

export type RunStatus =
  | 'in_progress'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed';

export type ClaimStatus = 'verified' | 'outdated' | 'uncertain';

export interface Source {
  id: string;
  title: string;
  url?: string;
  publisher: string;
  publishedAt?: string;
  retrievedAt?: string;
  excerpt: string;
  isDemoSource: boolean;
}

export interface Claim {
  id: string;
  text: string;
  status: ClaimStatus;
  explanation: string;
  sources: Source[];
  suggestedCorrection?: string;
  freshnessSensitive?: boolean;
}

export interface Patch {
  id: string;
  filePath: string;
  originalCode: string;
  proposedCode: string;
  explanation: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
}

export interface TestResult {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  output: string;
  simulated: boolean;
  durationMs?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  currency: string;
  simulated: boolean;
}

export interface WorkflowStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  description?: string;
}

export interface Run {
  id: string;
  title: string;
  type: RunType;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  errorInput?: string;
  codeInput?: string;
  answerInput?: string;
  diagnosis?: string;
  steps: WorkflowStep[];
  claims: Claim[];
  patch?: Patch;
  tests: TestResult[];
  usage: TokenUsage;
}

export interface AppSettings {
  workspaceName: string;
  defaultLandingPage: 'overview' | 'fix_code' | 'verify_answer' | 'runs';
  budgetMaxCost: number;
  budgetMaxTokens: number;
  budgetWarningThreshold: number; // percentage e.g. 80
  requireApprovalPatches: boolean;
  requireApprovalCommands: boolean;
  readOnlyAnalysisDefault: boolean;
}
