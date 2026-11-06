import React from 'react';
import { TokenUsage } from '../../types/domain';
import { Coins, Hash } from 'lucide-react';
import { formatTokens, formatCost } from '../../services/usage';

interface UsageSummaryProps {
  usage: TokenUsage;
  className?: string;
}

export function UsageSummary({ usage, className = '' }: UsageSummaryProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between text-xs text-[#66736F] border-b border-[#E3EAE6] pb-2">
        <span className="font-medium text-[#17201D]">Resource Accounting</span>
        <span className="text-[11px] text-[#66736F] font-mono">
          {usage.simulated ? 'Simulated usage' : usage.incompleteModelUsage ? 'Partial reported usage'
            : usage.isMeasured ? 'Reported gateway usage' : 'No token usage reported'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="p-3 bg-[#F8FAF9] rounded-lg border border-[#E3EAE6]">
          <div className="flex items-center gap-1.5 text-xs text-[#66736F] mb-1">
            <Hash className="w-3.5 h-3.5 text-[#08775E]" />
            <span>Input Tokens</span>
          </div>
          <div className="text-base font-semibold text-[#17201D] font-mono tabular-nums">
            {formatTokens(usage.inputTokens)}
          </div>
        </div>

        <div className="p-3 bg-[#F8FAF9] rounded-lg border border-[#E3EAE6]">
          <div className="flex items-center gap-1.5 text-xs text-[#66736F] mb-1">
            <Hash className="w-3.5 h-3.5 text-[#08775E]" />
            <span>Output Tokens</span>
          </div>
          <div className="text-base font-semibold text-[#17201D] font-mono tabular-nums">
            {formatTokens(usage.outputTokens)}
          </div>
        </div>
      </div>

      <div className="p-3 bg-[#F8FAF9] rounded-lg border border-[#E3EAE6] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-[#08775E]" />
          <div>
            <div className="text-xs text-[#66736F]">Estimated Cost</div>
            <div className="text-sm font-semibold text-[#17201D] font-mono tabular-nums">
              {formatCost(usage.estimatedCost)} {usage.estimatedCost === null ? '' : usage.currency}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-[#66736F]">Total Tokens</div>
          <div className="text-sm font-semibold text-[#17201D] font-mono tabular-nums">
            {formatTokens(usage.totalTokens)}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[#66736F] leading-relaxed">
        Missing accounting is not zero usage. Partial token totals may exclude unreported requests.
        Estimated costs are not provider invoices.
      </p>
    </div>
  );
}

interface BudgetIndicatorProps {
  currentTokens: number | null;
  maxTokens: number;
  className?: string;
}

export function BudgetIndicator({
  currentTokens,
  maxTokens,
  className = ''
}: BudgetIndicatorProps) {
  const safeMax = maxTokens > 0 ? maxTokens : 15000;
  const percentage = currentTokens === null ? null
    : Math.max(0, Math.min(100, Math.round((currentTokens / safeMax) * 100)));
  const isNearLimit = percentage !== null && percentage >= 80;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#66736F]">Run Budget Consumption</span>
        <span className="font-mono tabular-nums font-medium text-[#17201D]">
          {percentage === null ? `Consumption not reported / ${safeMax} tkns`
            : `${percentage}% (${currentTokens} / ${safeMax} tkns)`}
        </span>
      </div>
      <div className="w-full h-1.5 bg-[#E3EAE6] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isNearLimit ? 'bg-amber-500' : 'bg-[#08775E]'
          }`}
          style={{ width: `${percentage ?? 0}%` }}
        />
      </div>
    </div>
  );
}
