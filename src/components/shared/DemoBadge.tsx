import React from 'react';
import { Sparkles, Database } from 'lucide-react';

interface DemoBadgeProps {
  label?: string;
  variant?: 'subtle' | 'pill' | 'header';
}

export function DemoBadge({ label = 'Demo Mode', variant = 'header' }: DemoBadgeProps) {
  if (variant === 'header') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#08775E] bg-[#EAF6F0] border border-[#08775E]/20 rounded-md">
        <span className="w-1.5 h-1.5 rounded-full bg-[#08775E]" />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-[#66736F]">
      <Database className="w-3.5 h-3.5 text-[#08775E]" />
      <span>{label}</span>
    </div>
  );
}
