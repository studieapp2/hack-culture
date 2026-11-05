import { z } from 'zod';

// This is an MCP boundary, not a replacement for the backend contract.
export const diagnosisInput = z.object({
  error: z.string().min(1).max(20_000).refine(value => value.trim().length > 0),
  code: z.string().min(1).max(100_000).refine(value => value.trim().length > 0),
  fileName: z.string().min(1).max(300).refine(value => value.trim().length > 0 &&
    !/[\x00-\x1f]/.test(value) && !/^(?:[/\\]|[A-Za-z]:)/.test(value) &&
    !value.split(/[/\\]/).includes('..')).optional(),
  language: z.string().min(1).max(100).refine(value => value.trim().length > 0).optional(),
}).strict();

export type DiagnosisInput = z.infer<typeof diagnosisInput>;

// Runtime validator mirrors the published v1 boundary at 6a521b9; it does not
// change or implement the shared engine contract. Preserve backend metadata.
const nonnegative = z.number().finite().nonnegative();
const source = z.object({
  id: z.string(), title: z.string(), url: z.string().url(), publisher: z.string(),
  retrievedAt: z.string(), excerpt: z.string(),
}).passthrough();
const claim = z.object({
  id: z.string(), originalText: z.string(), startOffset: nonnegative,
  endOffset: nonnegative, freshnessSensitive: z.boolean(),
  status: z.enum(['VERIFIED', 'OUTDATED', 'INSUFFICIENT_EVIDENCE', 'UNCHECKABLE', 'ERROR']),
  explanation: z.string(), sources: z.array(source),
}).passthrough();
export const diagnosisResult = z.object({
  contractVersion: z.literal('1'),
  status: z.enum(['supported', 'insufficient_evidence', 'error']),
  diagnosis: z.object({
    summary: z.string(), evidenceStatus: z.enum(['supported', 'unverified']),
  }).nullable(),
  claims: z.array(claim), sources: z.array(source),
  proposedPatch: z.object({
    id: z.string(), filePath: z.string(), originalCode: z.string(), proposedCode: z.string(),
    unifiedDiff: z.string(), explanation: z.string(), approvalStatus: z.literal('pending'),
  }).optional(),
  tests: z.array(z.object({
    id: z.string(), name: z.string(), status: z.literal('not_run'),
    output: z.string(), reason: z.string(),
  })),
  usage: z.object({
    model: z.object({
      inputTokens: nonnegative, outputTokens: nonnegative, totalTokens: nonnegative,
      estimatedCost: nonnegative, currency: z.literal('USD'), isMeasured: z.boolean(),
      model: z.string(), latencyMs: nonnegative,
    }).passthrough().nullable(),
    modelCalls: nonnegative.int(), searchCalls: nonnegative.int(), extractionCalls: nonnegative.int(),
    searchCredits: nonnegative.nullable(), extractionCredits: nonnegative.nullable(),
    actualCostUsd: nonnegative.nullable(), estimatedCostUsd: nonnegative.nullable(),
    costBasis: z.enum(['no_requests', 'configured_rates', 'not_reported']),
    incompleteModelUsage: z.boolean(),
  }),
  errors: z.array(z.object({
    code: z.enum(['INVALID_INPUT', 'MISSING_CONFIGURATION', 'PROVIDER_ERROR',
      'INVALID_PROVIDER_RESPONSE', 'BUDGET_EXCEEDED', 'TIMEOUT',
      'INSUFFICIENT_EVIDENCE', 'INTERNAL_ERROR']),
    message: z.string(), retryable: z.boolean(),
    provider: z.enum(['bifrost', 'tavily']).optional(),
    configuration: z.array(z.string()).optional(),
  })),
  safety: z.object({
    codeExecuted: z.literal(false), codeModified: z.literal(false),
    approvalRequiredToApply: z.literal(true),
  }),
}).superRefine((result, context) => {
  if (result.status !== 'supported' && result.proposedPatch)
    context.addIssue({ code: 'custom', message: 'Unsupported results must not offer a verified patch.' });
  if (result.status === 'supported' && (!result.diagnosis ||
    result.diagnosis.evidenceStatus !== 'supported' || !result.sources.length))
    context.addIssue({ code: 'custom', message: 'Supported results require diagnosis and source evidence.' });
});
