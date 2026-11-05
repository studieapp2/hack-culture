import React from 'react';
import { RunStatus, ClaimStatus } from '../../types/domain';
import { CheckCircle2, Clock, Check, X, AlertTriangle, HelpCircle, Loader2 } from 'lucide-react';

interface RunStatusBadgeProps {
  status: RunStatus;
  size?: 'sm' | 'md';
}

export function RunStatusBadge({ status, size = 'sm' }: RunStatusBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  switch (status) {
    case 'awaiting_approval':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-amber-50 text-amber-800 border border-amber-200/80 ${sizeClasses} whitespace-nowrap`}
        >
          <Clock className="w-3 h-3 text-amber-600" />
          <span>Awaiting approval</span>
        </span>
      );
    case 'approved':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200/80 ${sizeClasses} whitespace-nowrap`}
        >
          <Check className="w-3 h-3 text-emerald-600" />
          <span>Approved</span>
        </span>
      );
    case 'rejected':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-rose-50 text-rose-800 border border-rose-200/80 ${sizeClasses} whitespace-nowrap`}
        >
          <X className="w-3 h-3 text-rose-600" />
          <span>Rejected</span>
        </span>
      );
    case 'completed':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-[#EAF6F0] text-[#065E4B] border border-[#08775E]/20 ${sizeClasses} whitespace-nowrap`}
        >
          <CheckCircle2 className="w-3 h-3 text-[#08775E]" />
          <span>Completed</span>
        </span>
      );
    case 'in_progress':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-slate-100 text-slate-800 border border-slate-200 ${sizeClasses} whitespace-nowrap`}
        >
          <Loader2 className="w-3 h-3 text-slate-600 animate-spin" />
          <span>In progress</span>
        </span>
      );
    case 'failed':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-rose-50 text-rose-800 border border-rose-200/80 ${sizeClasses} whitespace-nowrap`}
        >
          <AlertTriangle className="w-3 h-3 text-rose-600" />
          <span>Failed</span>
        </span>
      );
    case 'unknown':
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 ${sizeClasses}`}>
          <HelpCircle className="w-3 h-3" />
          <span>Unknown status</span>
        </span>
      );
    default:
      return null;
  }
}

interface ClaimStatusBadgeProps {
  status: ClaimStatus;
  size?: 'sm' | 'md';
}

export function ClaimStatusBadge({ status, size = 'sm' }: ClaimStatusBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  switch (status) {
    case 'verified':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200/80 ${sizeClasses} whitespace-nowrap`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>Verified</span>
        </span>
      );
    case 'outdated':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-rose-50 text-rose-800 border border-rose-200/80 ${sizeClasses} whitespace-nowrap`}
        >
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          <span>Outdated</span>
        </span>
      );
    case 'uncertain':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-md bg-amber-50 text-amber-800 border border-amber-200/80 ${sizeClasses} whitespace-nowrap`}
        >
          <HelpCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>Uncertain</span>
        </span>
      );
    default:
      return null;
  }
}
