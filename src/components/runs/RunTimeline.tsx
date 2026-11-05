import React from 'react';
import { WorkflowStep } from '../../types/domain';
import { Check, Loader2, Circle, AlertCircle } from 'lucide-react';

interface RunTimelineProps {
  steps: WorkflowStep[];
  currentStepIndex?: number;
  isProcessing?: boolean;
  className?: string;
  title?: string;
  context?: string;
}

export function RunTimeline({
  steps,
  currentStepIndex = steps.length - 1,
  isProcessing = false,
  className = '',
  title = 'Workflow Pipeline',
  context = 'Server Orchestration'
}: RunTimelineProps) {
  return (
    <div className={`p-5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs ${className}`}>
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-[#E3EAE6]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#17201D]">
            {title}
          </span>
          <span className="text-xs text-[#66736F]">·</span>
          <span className="text-xs text-[#08775E] bg-[#EAF6F0] px-2 py-0.5 rounded font-medium">
            {context}
          </span>
        </div>
        <span className="text-xs text-[#66736F] font-mono tabular-nums">
          {Math.min(currentStepIndex + 1, steps.length)} of {steps.length} steps
        </span>
      </div>

      <div className="space-y-3">
        {steps.map((step, idx) => {
          const isDone = step.status === 'completed';
          const isActive = step.status === 'active';
          const isFailed = step.status === 'failed';
          const isPending = !isDone && !isActive && !isFailed;

          return (
            <div key={step.id} className="flex items-start gap-3 relative">
              {/* Connector line */}
              {idx < steps.length - 1 && (
                <div
                  className={`absolute left-[13px] top-[26px] w-[2px] h-[calc(100%-8px)] transition-colors ${
                    isDone ? 'bg-[#08775E]' : 'bg-[#E3EAE6]'
                  }`}
                />
              )}

              {/* Status node */}
              <div className="relative z-10 shrink-0 mt-0.5">
                {isDone && (
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#08775E] text-white">
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  </div>
                )}
                {isActive && (
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#EAF6F0] border-2 border-[#08775E] text-[#08775E]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </div>
                )}
                {isFailed && (
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-rose-50 border-2 border-rose-600 text-rose-600">
                    <AlertCircle className="w-3.5 h-3.5" />
                  </div>
                )}
                {isPending && (
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#F8FAF9] border border-[#E3EAE6] text-[#66736F]">
                    <Circle className="w-3 h-3 text-[#E3EAE6]" />
                  </div>
                )}
              </div>

              {/* Step info */}
              <div className="flex-1 min-w-0 pt-0.5 pb-2">
                <div className="flex items-center justify-between">
                  <h4
                    className={`text-xs font-semibold ${
                      isActive
                        ? 'text-[#08775E]'
                        : isDone
                        ? 'text-[#17201D]'
                        : isFailed
                        ? 'text-rose-700'
                        : 'text-[#66736F]'
                    }`}
                  >
                    {step.label}
                  </h4>
                  {isActive && (
                    <span className="text-[11px] text-[#08775E] font-medium animate-pulse">
                      Processing...
                    </span>
                  )}
                </div>
                {step.description && (
                  <p className="text-[11px] text-[#66736F] mt-0.5">
                    {step.description}
                  </p>
                )}
                {step.status === 'skipped' && (
                  <p className="text-[11px] text-[#66736F] mt-0.5">Not performed</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
