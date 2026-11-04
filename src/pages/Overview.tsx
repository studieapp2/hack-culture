import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { SAMPLE_ERROR_INPUT, SAMPLE_CODE_INPUT } from '../data/demoFixtures';
import { RunStatusBadge } from '../components/shared/StatusBadge';
import {
  Wrench,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Terminal,
  Code2,
  FileCode,
  Clock,
  ExternalLink
} from 'lucide-react';

export function Overview() {
  const { navigateTo, runs, loadingRuns, runsError, refreshRuns, setDraftError, setDraftCode, setDraftFileName } = useApp();
  const [inputText, setInputText] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleTrySample = () => {
    setInputText(SAMPLE_ERROR_INPUT);
    setValidationError('');
  };

  const handleAnalyze = () => {
    if (!inputText.trim()) {
      setValidationError('Please paste an error, stack trace, or issue description to analyze.');
      return;
    }
    setDraftError(inputText.trim());
    setDraftCode(inputText === SAMPLE_ERROR_INPUT ? SAMPLE_CODE_INPUT : '');
    setDraftFileName(inputText === SAMPLE_ERROR_INPUT ? 'demo_client.py' : '');
    navigateTo('fix_code');
  };

  const handleOpenRun = (runId: string, runType: string) => {
    if (runType === 'code_fix') {
      navigateTo('fix_code', { runId });
    } else {
      navigateTo('verify_answer', { runId });
    }
  };

  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      {/* Hero section */}
      <div className="text-center sm:text-left space-y-3">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#08775E] tracking-wider uppercase">
          <Terminal className="w-3.5 h-3.5" />
          <span>AI Development Workspace</span>
        </div>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[#17201D] leading-tight text-balance">
          Fix what's broken.
          <br className="hidden sm:inline" />
          <span className="text-[#08775E]"> Verify what's changed.</span>
        </h1>
        <p className="text-base sm:text-lg text-[#66736F] max-w-2xl leading-relaxed">
          Diagnose errors, verify technical claims, and review safer code changes — without wasting tokens.
        </p>
      </div>

      {/* Primary Action Area: Command Workspace */}
      <div className="bg-white border border-[#E3EAE6] rounded-2xl shadow-sm p-5 sm:p-6 transition-all hover:border-[#08775E]/30">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#E3EAE6]">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#17201D]">
            <Code2 className="w-4 h-4 text-[#08775E]" />
            <span>Diagnostic Prompt</span>
          </div>
          <button
            onClick={handleTrySample}
            type="button"
            className="text-xs font-medium text-[#08775E] hover:text-[#065E4B] hover:underline transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>Try sample issue</span>
            <Sparkles className="w-3 h-3" />
          </button>
        </div>

        <div className="relative">
          <textarea
            aria-label="Error, stack trace, or issue description"
            aria-invalid={!!validationError}
            aria-describedby={validationError ? 'overview-validation' : undefined}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              if (validationError) setValidationError('');
            }}
            placeholder="Paste an error, stack trace, or describe what went wrong..."
            rows={4}
            className="w-full text-sm font-mono text-[#17201D] placeholder:text-[#66736F]/70 bg-[#F8FAF9] border border-[#E3EAE6] rounded-xl p-3.5 focus:outline-hidden focus:ring-2 focus:ring-[#08775E] focus:bg-white transition-all resize-y leading-relaxed"
          />
          {validationError && (
            <p id="overview-validation" role="alert" className="mt-1.5 text-xs text-rose-600 font-medium">{validationError}</p>
          )}
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <p className="text-xs text-[#66736F]">
            Start with an error. PatchPilot handles the claim check and targeted diff.
          </p>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleAnalyze}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#08775E] hover:bg-[#065E4B] rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              <span>Analyze issue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Two Secondary Entry Points */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => navigateTo('fix_code')}
          className="p-5 text-left bg-white border border-[#E3EAE6] hover:border-[#08775E]/40 hover:bg-[#F8FAF9] rounded-xl transition-all shadow-xs group cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#EAF6F0] text-[#08775E] mb-3">
              <Wrench className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-[#66736F] group-hover:text-[#08775E] group-hover:translate-x-0.5 transition-all" />
          </div>
          <h3 className="text-base font-semibold text-[#17201D] mb-1">
            Fix Code
          </h3>
          <p className="text-xs text-[#66736F] leading-relaxed">
            Find the cause. Verify the fix. Review the patch.
          </p>
        </button>

        <button
          onClick={() => navigateTo('verify_answer')}
          className="p-5 text-left bg-white border border-[#E3EAE6] hover:border-[#08775E]/40 hover:bg-[#F8FAF9] rounded-xl transition-all shadow-xs group cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 mb-3">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <ArrowRight className="w-4 h-4 text-[#66736F] group-hover:text-[#08775E] group-hover:translate-x-0.5 transition-all" />
          </div>
          <h3 className="text-base font-semibold text-[#17201D] mb-1">
            Verify Answer
          </h3>
          <p className="text-xs text-[#66736F] leading-relaxed">
            Find outdated claims before they cause problems.
          </p>
        </button>
      </div>

      {/* Recent Activity Section */}
      <div className="bg-white border border-[#E3EAE6] rounded-xl shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E3EAE6] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#08775E]" />
            <h2 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
              Recent Workspace Runs
            </h2>
          </div>
          <button
            onClick={() => navigateTo('runs')}
            className="text-xs font-medium text-[#08775E] hover:text-[#065E4B] transition-colors flex items-center gap-1 cursor-pointer"
          >
            <span>View all runs</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        <div className="divide-y divide-[#E3EAE6]">
          {runsError && (
            <div role="alert" className="p-5 text-xs text-rose-700">
              {runsError} <button onClick={refreshRuns} disabled={loadingRuns} className="underline">Retry</button>
            </div>
          )}
          {loadingRuns ? (
            <p role="status" className="p-5 text-xs text-[#66736F]">Loading runs…</p>
          ) : !runsError && runs.length === 0 && (
            <p className="p-5 text-xs text-[#66736F]">No runs yet. Analyze an issue or verify an answer to get started.</p>
          )}
          {runs.slice(0, 3).map((run) => (
            <button
              type="button"
              key={run.id}
              onClick={() => handleOpenRun(run.id, run.type)}
              className="w-full text-left px-5 py-3.5 hover:bg-[#F8FAF9] transition-colors flex flex-wrap items-center justify-between gap-4 cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-md bg-[#F8FAF9] text-[#66736F] shrink-0 border border-[#E3EAE6]">
                  {run.type === 'code_fix' ? (
                    <FileCode className="w-4 h-4 text-[#08775E]" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#17201D] truncate">
                    {run.title}
                  </div>
                  <div className="text-[11px] text-[#66736F] flex flex-wrap items-center gap-2 mt-0.5">
                    <span>{run.type === 'code_fix' ? 'Code Fix' : 'Verification'}</span>
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      {run.usage.totalTokens} tokens
                    </span>
                    <span>·</span>
                    <span>{new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <RunStatusBadge status={run.status} />
                <ArrowRight className="w-3.5 h-3.5 text-[#66736F]" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
