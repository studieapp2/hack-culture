import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { AppSettings } from '../types/domain';
import {
  Building2,
  Coins,
  ShieldAlert,
  Server,
  Layers,
  Check,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

export function Settings() {
  const { settings, updateSettings, health, loadingHealth, refreshHealth } = useApp();
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(formData);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const renderIntegrationBadge = (integration: { configured?: boolean; status?: string }) => {
    if (loadingHealth) {
      return (
        <span className="text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md">
          Checking...
        </span>
      );
    }
    if (integration?.status === 'connected_and_verified') {
      return (
        <span className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md flex items-center gap-1">
          <Check className="w-3 h-3 text-emerald-600" />
          <span>Connected & Verified</span>
        </span>
      );
    }
    if (integration?.configured) {
      return (
        <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
          Configured (Awaiting Ping)
        </span>
      );
    }
    return (
      <span className="text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md flex items-center gap-1">
        <AlertTriangle className="w-3 h-3 text-amber-500" />
        <span>Integration required</span>
      </span>
    );
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[#E3EAE6]">
        <div>
          <div className="text-xs font-semibold text-[#08775E] uppercase tracking-wider mb-1">
            System Administration
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17201D]">
            Settings & Integrations
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[#66736F]">
            Review server integration health, operational budget limits, and safety controls.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {savedNotice && (
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200/80 flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Preferences saved</span>
            </span>
          )}
          <button
            type="button"
            onClick={refreshHealth}
            disabled={loadingHealth}
            className="px-3 py-2 text-xs font-medium text-[#17201D] bg-white border border-[#E3EAE6] hover:bg-[#F8FAF9] rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin text-[#08775E]' : ''}`} />
            <span>Test Health</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#08775E] hover:bg-[#065E4B] rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            Save Preferences
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* SECTION A: Integrations Health */}
        <div className="p-6 bg-white border border-[#E3EAE6] rounded-xl shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E3EAE6]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#08775E]" />
              <h2 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                External Integrations Status
              </h2>
            </div>
            <span className="text-[11px] text-[#66736F]">
              Server Environment Validation
            </span>
          </div>

          <div className="divide-y divide-[#E3EAE6]">
            {/* Bifrost */}
            <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#17201D]">
                  Bifrost Gateway
                </div>
                <div className="text-[11px] text-[#66736F] mt-0.5">
                  Model routing, budget enforcement, and token accounting (`BIFROST_BASE_URL`).
                </div>
                {health?.integrations?.bifrost?.details && (
                  <div className="text-[11px] text-emerald-700 mt-1">
                    {health.integrations.bifrost.details}
                  </div>
                )}
                {health?.integrations?.bifrost?.error && (
                  <div className="text-[11px] text-rose-600 mt-1">
                    {health.integrations.bifrost.error}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {renderIntegrationBadge(health?.integrations?.bifrost || {})}
              </div>
            </div>

            {/* Tavily */}
            <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#17201D]">
                  Tavily Search & Extract
                </div>
                <div className="text-[11px] text-[#66736F] mt-0.5">
                  Current-source research and stale-answer verification (`TAVILY_API_KEY`).
                </div>
                {health?.integrations?.tavily?.details && (
                  <div className="text-[11px] text-emerald-700 mt-1">
                    {health.integrations.tavily.details}
                  </div>
                )}
                {health?.integrations?.tavily?.error && (
                  <div className="text-[11px] text-rose-600 mt-1">
                    {health.integrations.tavily.error}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {renderIntegrationBadge(health?.integrations?.tavily || {})}
              </div>
            </div>

            {/* GitHub */}
            <div className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#17201D]">GitHub</div>
                <div className="text-[11px] text-[#66736F] mt-0.5">
                  Direct repository integration and automated pull request submission.
                </div>
              </div>
              <span className="text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-md shrink-0">
                Not connected
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#F8FAF9] border border-[#E3EAE6] text-xs text-[#66736F] leading-relaxed">
            <span className="font-semibold text-[#17201D]">Security Invariant:</span> Credentials are loaded exclusively via server-side environment variables (`TAVILY_API_KEY`, `BIFROST_BASE_URL`). Secrets are never exposed to the client bundle or browser DOM.
          </div>
        </div>

        {/* SECTION B: Workspace Preferences */}
        <div className="p-6 bg-white border border-[#E3EAE6] rounded-xl shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#E3EAE6]">
            <Building2 className="w-4 h-4 text-[#08775E]" />
            <h2 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
              Workspace Preferences
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#17201D] mb-1.5">
                Workspace Name
              </label>
              <input
                type="text"
                value={formData.workspaceName}
                onChange={(e) => handleChange('workspaceName', e.target.value)}
                className="w-full text-xs text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-lg p-2.5 focus:outline-hidden focus:ring-1 focus:ring-[#08775E] focus:bg-white transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#17201D] mb-1.5">
                Default Landing Page
              </label>
              <select
                value={formData.defaultLandingPage}
                onChange={(e) =>
                  handleChange('defaultLandingPage', e.target.value as AppSettings['defaultLandingPage'])
                }
                className="w-full text-xs text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-lg p-2.5 focus:outline-hidden focus:ring-1 focus:ring-[#08775E] cursor-pointer"
              >
                <option value="overview">Overview</option>
                <option value="fix_code">Fix Code</option>
                <option value="verify_answer">Verify Answer</option>
                <option value="runs">Runs</option>
              </select>
            </div>
          </div>
        </div>

        {/* SECTION C: Budget Controls */}
        <div className="p-6 bg-white border border-[#E3EAE6] rounded-xl shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E3EAE6]">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-[#08775E]" />
              <h2 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                Operational Budget Controls
              </h2>
            </div>
            <span className="text-[11px] text-[#08775E] bg-[#EAF6F0] px-2 py-0.5 rounded font-medium">
              Enforced on server
            </span>
          </div>

          <p className="text-xs text-[#66736F]">
            Strict per-run budgets protect against infinite model retry loops and excessive token consumption.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#17201D] mb-1.5">
                Max Cost per Run ($)
              </label>
              <input
                type="number"
                disabled
                value={health?.budgets?.maxCostPerRunUsd ?? formData.budgetMaxCost}
                className="w-full text-xs font-mono text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-lg p-2.5 opacity-80 tabular-nums cursor-not-allowed"
              />
              <span className="text-[10px] text-[#66736F] mt-1 block">Configured in env</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#17201D] mb-1.5">
                Max Model Tokens per Run
              </label>
              <input
                type="number"
                disabled
                value={health?.budgets?.maxTokensPerRun ?? formData.budgetMaxTokens}
                className="w-full text-xs font-mono text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-lg p-2.5 opacity-80 tabular-nums cursor-not-allowed"
              />
              <span className="text-[10px] text-[#66736F] mt-1 block">Configured in env</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#17201D] mb-1.5">
                Max Model Calls per Run
              </label>
              <input
                type="number"
                disabled
                value={health?.budgets?.maxModelCallsPerRun ?? 4}
                className="w-full text-xs font-mono text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-lg p-2.5 opacity-80 tabular-nums cursor-not-allowed"
              />
              <span className="text-[10px] text-[#66736F] mt-1 block">Configured in env</span>
            </div>
          </div>
        </div>

        {/* SECTION D: Safety Controls */}
        <div className="p-6 bg-white border border-[#E3EAE6] rounded-xl shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#E3EAE6]">
            <ShieldAlert className="w-4 h-4 text-[#08775E]" />
            <h2 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
              Safety Controls & Human Invariants
            </h2>
          </div>

          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 rounded-lg border border-[#E3EAE6] bg-[#F8FAF9]/50">
              <input
                type="checkbox"
                checked={formData.requireApprovalPatches}
                onChange={(e) => handleChange('requireApprovalPatches', e.target.checked)}
                className="mt-0.5 rounded text-[#08775E] focus:ring-[#08775E] border-[#E3EAE6]"
              />
              <div>
                <span className="text-xs font-semibold text-[#17201D] block">
                  Require approval before applying patches
                </span>
                <span className="text-[11px] text-[#66736F]">
                  Forces an interactive developer review before any code change is recorded.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-lg border border-[#E3EAE6] bg-[#F8FAF9]/50">
              <input
                type="checkbox"
                checked={formData.requireApprovalCommands}
                onChange={(e) => handleChange('requireApprovalCommands', e.target.checked)}
                className="mt-0.5 rounded text-[#08775E] focus:ring-[#08775E] border-[#E3EAE6]"
              />
              <div>
                <span className="text-xs font-semibold text-[#17201D] block">
                  Require approval before running test commands
                </span>
                <span className="text-[11px] text-[#66736F]">
                  Guarantees that no test execution occurs without explicit operator authorization.
                </span>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-lg border border-[#E3EAE6] bg-[#F8FAF9]/50">
              <input
                type="checkbox"
                checked={formData.readOnlyAnalysisDefault}
                onChange={(e) => handleChange('readOnlyAnalysisDefault', e.target.checked)}
                className="mt-0.5 rounded text-[#08775E] focus:ring-[#08775E] border-[#E3EAE6]"
              />
              <div>
                <span className="text-xs font-semibold text-[#17201D] block">
                  Enable read-only analysis by default
                </span>
                <span className="text-[11px] text-[#66736F]">
                  Restricts all diagnostic runs to static AST analysis and retrieval without filesystem write privileges.
                </span>
              </div>
            </label>
          </div>
        </div>
      </form>
    </div>
  );
}
