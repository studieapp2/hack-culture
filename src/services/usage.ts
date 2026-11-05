import type { TokenUsage } from '../types/domain';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const count = (value: unknown): number | null => {
  const number = amount(value);
  return number !== null && Number.isInteger(number) ? number : null;
};

/** Preserve unknown/partial accounting instead of presenting missing data as zero. */
export function normalizeUsage(value: unknown): TokenUsage {
  const usage = record(value);
  const nested = usage.model === null || (usage.model && typeof usage.model === 'object');
  const model = nested ? record(usage.model) : usage;
  const simulated = model.simulated === true;
  const input = count(model.inputTokens);
  const output = count(model.outputTokens);
  const total = count(model.totalTokens);
  const validCounts = input !== null && output !== null && total === input + output;
  const isMeasured = model.isMeasured === true && validCounts;
  const displayCounts = validCounts && (isMeasured || simulated);
  const explicitEstimate = amount(usage.estimatedCostUsd);
  return {
    inputTokens: displayCounts ? input : null,
    outputTokens: displayCounts ? output : null,
    totalTokens: displayCounts ? total : null,
    estimatedCost: nested ? explicitEstimate
      : (isMeasured || simulated) ? amount(model.estimatedCost) : null,
    actualCost: amount(usage.actualCostUsd),
    currency: typeof model.currency === 'string' ? model.currency : 'USD',
    simulated,
    isMeasured,
    incompleteModelUsage: usage.incompleteModelUsage === true,
    modelCalls: count(usage.modelCalls),
    costBasis: typeof usage.costBasis === 'string' ? usage.costBasis
      : typeof model.costBasis === 'string' ? model.costBasis : 'not_reported',
  };
}

export const formatTokens = (value: number | null): string =>
  value === null ? 'Not reported' : value.toLocaleString();
export const formatCost = (value: number | null): string =>
  value === null ? 'Not reported' : `$${value.toFixed(4)}`;
