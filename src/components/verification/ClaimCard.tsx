import React from 'react';
import { Claim } from '../../types/domain';
import { ClaimStatusBadge } from '../shared/StatusBadge';
import { FileText, ArrowRight, ShieldAlert, Sparkles } from 'lucide-react';

interface ClaimCardProps {
  claim: Claim;
  isSelected?: boolean;
  onSelect?: () => void;
  className?: string;
}

export function ClaimCard({
  claim,
  isSelected = false,
  onSelect,
  className = ''
}: ClaimCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-xl border transition-all text-left cursor-pointer ${
        isSelected
          ? 'bg-white border-[#08775E] ring-1 ring-[#08775E] shadow-sm'
          : 'bg-white hover:bg-[#F8FAF9] border-[#E3EAE6] shadow-xs'
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <p className="text-sm font-semibold text-[#17201D] leading-snug">
            "{claim.text}"
          </p>
        </div>
        <div className="shrink-0">
          <ClaimStatusBadge status={claim.status} />
        </div>
      </div>

      <p className="text-xs text-[#66736F] line-clamp-2 leading-relaxed mb-3">
        {claim.explanation}
      </p>

      {/* Suggested correction preview if outdated */}
      {claim.status === 'outdated' && claim.suggestedCorrection && (
        <div className="p-2.5 rounded-lg bg-rose-50/70 border border-rose-200/60 text-xs mb-3">
          <span className="font-semibold text-rose-800">Correction: </span>
          <span className="text-rose-900">{claim.suggestedCorrection}</span>
        </div>
      )}

      {/* Metadata bar */}
      <div className="flex items-center justify-between text-[11px] text-[#66736F] border-t border-[#E3EAE6]/70 pt-2.5">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-[#08775E]" />
          <span>
            {claim.sources.length > 0
              ? `${claim.sources.length} sample source${claim.sources.length > 1 ? 's' : ''}`
              : 'Direct API heuristic'}
          </span>
        </div>

        <div className="inline-flex items-center gap-1 text-[#08775E] font-medium group">
          <span>{isSelected ? 'Viewing evidence' : 'Inspect evidence'}</span>
          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </div>
  );
}
