import React, { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  children?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-white border border-[#E3EAE6] rounded-xl my-6">
      <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-[#EAF6F0] text-[#08775E] mb-4">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-[#17201D] mb-1">{title}</h3>
      <p className="text-sm text-[#66736F] max-w-md mb-6 leading-relaxed">
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 text-sm font-medium text-white bg-[#08775E] hover:bg-[#065E4B] rounded-lg transition-colors shadow-sm"
        >
          {action.label}
        </button>
      )}
      {children}
    </div>
  );
}
