import { MeasuredTokenUsage } from '../types';

export interface RunBudget {
  callCount: number;
  totalTokensUsed: number;
  searchCount: number;
  reservedModelCalls?: number;
  requireReportedUsage?: boolean;
  deadlineAt: number;
  usageReports: number;
  searchRequests: number;
  extractionRequests: number;
  searchCredits: number;
  extractionCredits: number;
  searchUsageReports: number;
  extractionUsageReports: number;
  usage: MeasuredTokenUsage;
}

export function createRunBudget(): RunBudget {
  return {
    callCount: 0, totalTokensUsed: 0, searchCount: 0, deadlineAt: Date.now() + 90000,
    usageReports: 0, searchRequests: 0, extractionRequests: 0,
    searchCredits: 0, extractionCredits: 0, searchUsageReports: 0, extractionUsageReports: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0,
      currency: 'USD', isMeasured: false, model: 'unspecified', latencyMs: 0 }
  };
}

export function recordUsage(budget: RunBudget, usage: MeasuredTokenUsage): void {
  if (usage.usageReported) budget.usageReports++;
  budget.totalTokensUsed += usage.totalTokens;
  const costBasis = budget.usage.costBasis && budget.usage.costBasis !== usage.costBasis
    ? 'mixed' : usage.costBasis;
  budget.usage = {
    ...usage,
    inputTokens: budget.usage.inputTokens + usage.inputTokens,
    outputTokens: budget.usage.outputTokens + usage.outputTokens,
    totalTokens: budget.totalTokensUsed,
    estimatedCost: budget.usage.estimatedCost + usage.estimatedCost,
    latencyMs: budget.usage.latencyMs + usage.latencyMs,
    isMeasured: budget.usage.model === 'unspecified' ? usage.isMeasured : budget.usage.isMeasured && usage.isMeasured,
    fallbackUsed: budget.usage.fallbackUsed || usage.fallbackUsed,
    costBasis
  };
}
