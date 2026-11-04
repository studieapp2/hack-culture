import React, { useState } from 'react';
import { Copy, Check, FileCode, ArrowRight } from 'lucide-react';
import { Patch } from '../../types/domain';

interface CodeDiffProps {
  patch: Patch;
  className?: string;
}

export function CodeDiff({ patch, className = '' }: CodeDiffProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(patch.proposedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const originalLines = patch.originalCode.split('\n');
  const proposedLines = patch.proposedCode.split('\n');

  return (
    <div className={`border border-[#E3EAE6] rounded-xl overflow-hidden bg-white shadow-sm ${className}`}>
      {/* File header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#F8FAF9] border-b border-[#E3EAE6]">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-[#08775E]" />
          <span className="font-mono text-xs font-semibold text-[#17201D]">
            {patch.filePath}
          </span>
          <span className="text-xs text-[#66736F]">·</span>
          <span className="text-xs text-[#66736F]">
            {originalLines.length} lines modified
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#66736F] hover:text-[#17201D] hover:bg-white rounded-md border border-transparent hover:border-[#E3EAE6] transition-colors"
          title="Copy proposed code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy fix</span>
            </>
          )}
        </button>
      </div>

      {/* Patch rationale summary */}
      {patch.explanation && (
        <div className="px-4 py-2 bg-[#F8FAF9]/50 border-b border-[#E3EAE6] text-xs text-[#66736F] flex items-center gap-2">
          <span className="font-medium text-[#17201D]">Rationale:</span>
          <span>{patch.explanation}</span>
        </div>
      )}

      {/* Code diff container with dark IDE feel */}
      <div className="bg-[#101816] text-[#E3EAE6] font-mono text-xs p-3 overflow-x-auto">
        <div className="space-y-0.5">
          {/* Removed original lines */}
          {originalLines.map((line, idx) => (
            <div
              key={`orig-${idx}`}
              className="flex items-start bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 px-2 py-0.5 rounded-sm"
            >
              <span className="w-6 shrink-0 text-rose-500/70 select-none text-[11px]">-</span>
              <span className="whitespace-pre">{line}</span>
            </div>
          ))}

          {/* Added proposed lines */}
          {proposedLines.map((line, idx) => (
            <div
              key={`prop-${idx}`}
              className="flex items-start bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500 px-2 py-0.5 rounded-sm"
            >
              <span className="w-6 shrink-0 text-emerald-500/70 select-none text-[11px]">+</span>
              <span className="whitespace-pre">{line}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
