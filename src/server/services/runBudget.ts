import { MeasuredTokenUsage } from '../types';

export interface RunBudget {
  callCount: number;
  totalTokensUsed: number;
  searchCount: number;
  reservedModelCalls?: number;
  deadlineAt: number;
  usage: MeasuredTokenUsage;
}

export function createRunBudget(): RunBudget {
  return {
    callCount: 0, totalTokensUsed: 0, searchCount: 0, deadlineAt: Date.now() + 90000,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0,
      currency: 'USD', isMeasured: false, model: 'unspecified', latencyMs: 0 }
  };
}

export function recordUsage(budget: RunBudget, usage: MeasuredTokenUsage): void {
  budget.totalTokensUsed += usage.totalTokens;
  budget.usage = {
    ...usage,
    inputTokens: budget.usage.inputTokens + usage.inputTokens,
    outputTokens: budget.usage.outputTokens + usage.outputTokens,
    totalTokens: budget.totalTokensUsed,
    estimatedCost: budget.usage.estimatedCost + usage.estimatedCost,
    latencyMs: budget.usage.latencyMs + usage.latencyMs,
    isMeasured: budget.usage.model === 'unspecified' ? usage.isMeasured : budget.usage.isMeasured && usage.isMeasured,
    fallbackUsed: budget.usage.fallbackUsed || usage.fallbackUsed
  };
}
