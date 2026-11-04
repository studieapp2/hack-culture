import React from 'react';
import { Claim } from '../../types/domain';
import { ClaimStatusBadge } from '../shared/StatusBadge';
import {
  Calendar,
  ExternalLink,
  Info,
  X,
  AlertTriangle,
  HelpCircle
} from 'lucide-react';

interface EvidencePanelProps {
  claim: Claim | null;
  onClose?: () => void;
  className?: string;
}

export function EvidencePanel({ claim, onClose, className = '' }: EvidencePanelProps) {
  if (!claim) {
    return (
      <div className={`p-6 bg-white border border-[#E3EAE6] rounded-xl text-center ${className}`}>
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#F8FAF9] text-[#66736F] mx-auto mb-3">
          <Info className="w-5 h-5 text-[#08775E]" />
        </div>
        <h4 className="text-sm font-semibold text-[#17201D] mb-1">
          Select a claim to inspect
        </h4>
        <p className="text-xs text-[#66736F] leading-relaxed">
          Click any claim on the left to inspect retrieved sources, verification rationale, and suggested corrections.
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-white border border-[#E3EAE6] rounded-xl overflow-hidden shadow-xs flex flex-col ${className}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 px-5 py-3.5 bg-[#F8FAF9] border-b border-[#E3EAE6]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
            Claim Evidence Dossier
          </span>
          <span className="text-xs text-[#66736F]">·</span>
          <ClaimStatusBadge status={claim.status} />
        </div>
        {onClose && (
          <button
            aria-label="Close evidence inspector"
            onClick={onClose}
            className="p-1 text-[#66736F] hover:text-[#17201D] rounded-md hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="Close inspector"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-5 space-y-5 overflow-y-auto max-h-[70vh]">
        {/* Claim text */}
        <div>
          <div className="text-xs font-medium text-[#66736F] uppercase tracking-wider mb-1.5">
            Original Claim
          </div>
          <div className="p-3 bg-[#F8FAF9] rounded-lg border border-[#E3EAE6] text-sm font-medium text-[#17201D]">
            "{claim.text}"
          </div>
        </div>

        {/* Verification rationale */}
        <div>
          <div className="text-xs font-medium text-[#66736F] uppercase tracking-wider mb-1.5">
            Verification Assessment
          </div>
          <div className="text-xs text-[#17201D] leading-relaxed bg-[#F8FAF9]/60 p-3 rounded-lg border border-[#E3EAE6]">
            {claim.explanation}
          </div>
        </div>

        {/* Correction if outdated */}
        {claim.status === 'outdated' && claim.suggestedCorrection && (
          <div>
            <div className="text-xs font-medium text-rose-800 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              <span>Recommended Correction</span>
            </div>
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-950">
              {claim.suggestedCorrection}
            </div>
          </div>
        )}

        {/* Uncertainty notice if uncertain */}
        {claim.status === 'uncertain' && (
          <div>
            <div className="text-xs font-medium text-amber-800 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
              <span>Uncertainty Rationale</span>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 leading-relaxed">
              Available evidence from official documentation neither conclusively confirms nor refutes this claim. Per PatchPilot guidelines, claims without conclusive proof remain categorized as uncertain.
            </div>
          </div>
        )}

        {/* Supporting sources */}
        <div>
          <div className="text-xs font-medium text-[#66736F] uppercase tracking-wider mb-2">
            Supporting Evidence Sources ({claim.sources.length})
          </div>

          {claim.sources.length === 0 ? (
            <div className="p-3 rounded-lg bg-[#F8FAF9] border border-[#E3EAE6] text-xs text-[#66736F]">
              No external documentation matched this assertion or live retrieval was unconfigured.
            </div>
          ) : (
            <div className="space-y-3">
              {claim.sources.map((src) => (
                <div
                  key={src.id}
                  className="p-3.5 rounded-lg border border-[#E3EAE6] bg-[#F8FAF9]/50 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-xs text-[#17201D]">
                      {src.title}
                    </div>
                    {src.url && /^https?:\/\//i.test(src.url) && (
                      <a
                        aria-label={`Visit ${src.title}`}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#08775E] hover:text-[#065E4B] shrink-0 inline-flex items-center gap-1 text-[11px]"
                      >
                        <span>Visit</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  <div className="text-[11px] text-[#66736F] flex items-center gap-2">
                    <span>{src.publisher}</span>
                    {src.publishedAt && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-[#66736F]" />
                          {src.publishedAt}
                        </span>
                      </>
                    )}
                  </div>

                  <blockquote className="border-l-2 border-[#08775E] pl-2.5 text-xs text-[#17201D] italic bg-white p-2 rounded-r-md">
                    "{src.excerpt}"
                  </blockquote>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Real system notice */}
        <div className="p-3 rounded-lg bg-[#EAF6F0] border border-[#08775E]/20 text-[11px] text-[#065E4B] leading-relaxed">
          <span className="font-semibold">Verification Pipeline:</span> Sources are retrieved and evaluated through the server-side Tavily and Bifrost integration layer.
        </div>
      </div>
    </div>
  );
}
