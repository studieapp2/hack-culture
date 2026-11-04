import React from 'react';
import { useApp, NavigationPage } from '../../context/AppContext';
import { Logo } from '../shared/Logo';
import {
  LayoutDashboard,
  Wrench,
  ShieldCheck,
  History,
  Settings,
  RefreshCw
} from 'lucide-react';

interface SidebarProps {
  onCloseMobile?: () => void;
}

export function Sidebar({ onCloseMobile }: SidebarProps) {
  const { activePage, navigateTo, settings, refreshHealth, refreshRuns, loadingHealth, loadingRuns } = useApp();

  const handleNav = (page: NavigationPage) => {
    navigateTo(page);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const navItems: { id: NavigationPage; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'fix_code', label: 'Fix Code', icon: Wrench },
    { id: 'verify_answer', label: 'Verify Answer', icon: ShieldCheck },
    { id: 'runs', label: 'Runs', icon: History }
  ];

  return (
    <aside className="w-[240px] h-full flex flex-col bg-white border-r border-[#E3EAE6] select-none shrink-0">
      {/* Brand logo header */}
      <div className="h-[60px] px-5 flex items-center border-b border-[#E3EAE6]">
        <button
          onClick={() => handleNav('overview')}
          className="text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-[#08775E] rounded-md"
        >
          <Logo />
        </button>
      </div>

      {/* Main navigation */}
      <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-2 pb-1.5 text-[11px] font-semibold text-[#66736F] uppercase tracking-wider">
          Workspace
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;

          return (
            <button
              key={item.id}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleNav(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap text-left ${
                isActive
                  ? 'bg-[#EAF6F0] text-[#065E4B] font-semibold'
                  : 'text-[#17201D] hover:bg-[#F8FAF9] hover:text-[#08775E]'
              }`}
            >
              <Icon
                className={`w-4 h-4 shrink-0 transition-colors ${
                  isActive ? 'text-[#08775E]' : 'text-[#66736F]'
                }`}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        <div className="pt-4 pb-1.5 px-2">
          <div className="h-px bg-[#E3EAE6] mb-3" />
          <span className="text-[11px] font-semibold text-[#66736F] uppercase tracking-wider">
            System
          </span>
        </div>

        <button
          aria-current={activePage === 'settings' ? 'page' : undefined}
          onClick={() => handleNav('settings')}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap text-left ${
            activePage === 'settings'
              ? 'bg-[#EAF6F0] text-[#065E4B] font-semibold'
              : 'text-[#17201D] hover:bg-[#F8FAF9] hover:text-[#08775E]'
          }`}
        >
          <Settings
            className={`w-4 h-4 shrink-0 transition-colors ${
              activePage === 'settings' ? 'text-[#08775E]' : 'text-[#66736F]'
            }`}
          />
          <span className="truncate">Settings</span>
        </button>
      </div>

      {/* Sync / Refresh status & Workspace info */}
      <div className="p-3 border-t border-[#E3EAE6] space-y-2 bg-[#F8FAF9]/50">
        <button
          onClick={() => {
            refreshHealth();
            refreshRuns();
          }}
          disabled={loadingHealth || loadingRuns}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 text-[11px] font-medium text-[#66736F] hover:text-[#17201D] hover:bg-white rounded border border-[#E3EAE6] transition-colors"
          title="Refresh server status"
        >
          <RefreshCw className={`w-3 h-3 ${loadingHealth ? 'animate-spin text-[#08775E]' : ''}`} />
          <span>Sync Server Status</span>
        </button>

        <div className="pt-1 flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-white border border-[#E3EAE6]">
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#08775E]/10 text-[#08775E] shrink-0 font-semibold text-xs">
            {settings.workspaceName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-semibold text-[#17201D] truncate">
              {settings.workspaceName}
            </span>
            <span className="text-[10px] text-[#66736F] truncate">
              developer@patchpilot.internal
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
