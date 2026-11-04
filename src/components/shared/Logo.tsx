import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className = '', size = 28 }: LogoProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        className="flex items-center justify-center rounded-lg bg-[#08775E] text-white shadow-sm shrink-0"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4"
        >
          {/* Subtle code bracket on left */}
          <path d="M7 8L3.5 12L7 16" opacity="0.85" />
          {/* Precision verify checkmark in center */}
          <path d="M8.5 12.5L11.5 15.5L18.5 7.5" stroke="#FFFFFF" strokeWidth="2.5" />
          {/* Subtle code bracket on right */}
          <path d="M17 16L20.5 12L17 8" opacity="0.85" />
        </svg>
      </div>
      <div className="flex flex-col">
        <span className="text-[15px] font-semibold tracking-tight text-[#17201D] leading-none">
          PatchPilot
        </span>
      </div>
    </div>
  );
}
