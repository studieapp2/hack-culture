import React from 'react';
import { useApp } from '../../context/AppContext';
import { Menu, Wrench, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';

interface TopBarProps {
  onOpenMobileMenu: () => void;
}

export function TopBar({ onOpenMobileMenu }: TopBarProps) {
  const { activePage, navigateTo, setDraftError, setDraftCode, setDraftFileName, health, loadingHealth } = useApp();

  const getPageMeta = () => {
    switch (activePage) {
      case 'overview':
        return { title: 'Workspace Overview', breadcrumb: 'Platform' };
      case 'connect':
        return { title: 'Connect Your Editor', breadcrumb: 'Integrations' };
      case 'fix_code':
        return { title: 'Fix Code', breadcrumb: 'Coding Agent' };
      case 'verify_answer':
        return { title: 'Verify Answer', breadcrumb: 'Stale-Answer Detector' };
      case 'runs':
        return { title: 'Run History', breadcrumb: 'Operations' };
      case 'settings':
        return { title: 'Workspace Settings', breadcrumb: 'Configuration' };
      default:
        return { title: 'PatchPilot', breadcrumb: 'Platform' };
    }
  };

  const { title, breadcrumb } = getPageMeta();

  const renderHealthBadge = () => {
    if (loadingHealth) {
      return (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#66736F] bg-slate-100 rounded-md">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
          <span>Checking server...</span>
        </div>
      );
    }

    if (!health || health.status === 'unconfigured') {
      return (
        <button
          onClick={() => navigateTo('settings')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200/80 rounded-md cursor-pointer hover:bg-amber-100/80 transition-colors"
          title="Click to view required credentials in Settings"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          <span>{health ? 'Integration required' : 'Server unavailable'}</span>
        </button>
      );
    }

    if (health.status === 'degraded') {
      return (
        <button
          onClick={() => navigateTo('settings')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200/80 rounded-md cursor-pointer hover:bg-amber-100/80 transition-colors"
          title="One or more integrations require configuration"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
          <span>Partial Integration</span>
        </button>
      );
    }

    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#08775E] bg-[#EAF6F0] border border-[#08775E]/20 rounded-md">
        <CheckCircle2 className="w-3.5 h-3.5 text-[#08775E]" />
        <span>Integrations reachable</span>
      </div>
    );
  };

  return (
    <header className="min-h-[60px] shrink-0 px-3 sm:px-6 bg-white border-b border-[#E3EAE6] flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-30">
      {/* Left zone: Mobile toggle + Breadcrumb / Title */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-1.5 -ml-1 text-[#66736F] hover:text-[#17201D] hover:bg-[#F8FAF9] rounded-lg transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-xs font-medium text-[#66736F]">
          <span className="hidden sm:inline">{breadcrumb}</span>
          <span className="hidden sm:inline">/</span>
          <span className="font-semibold text-[#17201D] text-sm sm:text-xs">
            {title}
          </span>
        </div>
      </div>

      {/* Right zone: Truthful Status Badge + Action */}
      <div className="flex items-center gap-3 shrink-0">
        {renderHealthBadge()}

        {activePage !== 'fix_code' && (
          <button
            onClick={() => {
              setDraftError('');
              setDraftCode('');
              setDraftFileName('');
              navigateTo('fix_code');
            }}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#08775E] hover:bg-[#065E4B] rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>New Fix</span>
          </button>
        )}
      </div>
    </header>
  );
}
