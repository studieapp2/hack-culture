import React from 'react';
import { Claim } from '../../types/domain';
import { CheckCircle2, AlertTriangle, HelpCircle, Layers } from 'lucide-react';

interface VerificationSummaryProps {
  claims: Claim[];
  className?: string;
}

export function VerificationSummary({ claims, className = '' }: VerificationSummaryProps) {
  const verifiedCount = claims.filter((c) => c.status === 'verified').length;
  const outdatedCount = claims.filter((c) => c.status === 'outdated').length;
  const uncertainCount = claims.filter((c) => c.status === 'uncertain').length;

  return (
    <div
      className={`grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-white border border-[#E3EAE6] rounded-xl shadow-sm ${className}`}
    >
      <div className="flex items-center gap-3 p-2 rounded-lg bg-[#F8FAF9]">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-[#EAF6F0] text-[#08775E] shrink-0">
          <Layers className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[11px] font-medium text-[#66736F]">Total Claims</div>
          <div className="text-base font-bold text-[#17201D] font-mono tabular-nums">
            {claims.length}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 p-2 rounded-lg bg-[#F8FAF9]">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-50 text-emerald-700 shrink-0">
          <CheckCircle2 className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[11px] font-medium text-[#66736F]">Verified</div>
          <div className="text-base font-bold text-emerald-700 font-mono tabular-nums">
            {verifiedCount}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 p-2 rounded-lg bg-[#F8FAF9]">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-rose-50 text-rose-700 shrink-0">
          <AlertTriangle className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[11px] font-medium text-[#66736F]">Outdated</div>
          <div className="text-base font-bold text-rose-700 font-mono tabular-nums">
            {outdatedCount}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 p-2 rounded-lg bg-[#F8FAF9]">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-amber-50 text-amber-700 shrink-0">
          <HelpCircle className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[11px] font-medium text-[#66736F]">Uncertain</div>
          <div className="text-base font-bold text-amber-700 font-mono tabular-nums">
            {uncertainCount}
          </div>
        </div>
      </div>
    </div>
  );
}
