import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { apiClient } from '../services/apiClient';
import { Run, Claim } from '../types/domain';
import {
  SAMPLE_ERROR_INPUT,
  SAMPLE_CODE_INPUT
} from '../data/demoFixtures';
import { RunTimeline } from '../components/runs/RunTimeline';
import { CodeDiff } from '../components/code/CodeDiff';
import { ClaimCard } from '../components/verification/ClaimCard';
import { EvidencePanel } from '../components/verification/EvidencePanel';
import { RunStatusBadge } from '../components/shared/StatusBadge';
import { UsageSummary, BudgetIndicator } from '../components/shared/UsageSummary';
import {
  Upload,
  Sparkles,
  ArrowRight,
  FileCode,
  RotateCcw,
  ShieldCheck,
  Check,
  X,
  Server,
  AlertCircle,
  HelpCircle
} from 'lucide-react';

export function FixCode() {
  const {
    runs,
    selectedRunId,
    setSelectedRunId,
    draftError,
    setDraftError,
    draftCode,
    setDraftCode,
    draftFileName,
    setDraftFileName,
    refreshRuns,
    approvePatch,
    rejectPatch,
    settings,
    health
  } = useApp();

  const [workflowState, setWorkflowState] = useState<'input' | 'simulating' | 'complete'>('input');
  const [activeRun, setActiveRun] = useState<Run | null>(null);

  // Form inputs
  const [errorInput, setErrorInput] = useState(draftError || '');
  const [codeInput, setCodeInput] = useState(draftCode || '');
  const [fileName, setFileName] = useState(draftFileName);
  const [validationError, setValidationError] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);

  useEffect(() => {
    if (selectedRunId) {
      const existing = runs.find((r) => r.id === selectedRunId);
      if (existing?.type === 'code_fix') {
        setActiveRun(existing);
        setWorkflowState('complete');
        setSelectedClaim((prev) => existing.claims.find((claim) => claim.id === prev?.id) || existing.claims[0] || null);
      }
    }
  }, [selectedRunId, runs]);

  const handleLoadSample = () => {
    setErrorInput(SAMPLE_ERROR_INPUT);
    setCodeInput(SAMPLE_CODE_INPUT);
    setDraftError(SAMPLE_ERROR_INPUT);
    setDraftCode(SAMPLE_CODE_INPUT);
    setFileName('demo_client.py');
    setDraftFileName('demo_client.py');
    setValidationError('');
    setServerError(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      if (file.size > 100_000) {
        setServerError('Please upload a text/code file smaller than 100 KB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setFileName(file.name);
        setDraftFileName(file.name);
        setCodeInput(text);
        setDraftCode(text);
        setServerError(null);
      };
      reader.onerror = () => setServerError('Unable to read this file. Please paste the code instead.');
      reader.readAsText(file);
    }
  };

  const handleStartAnalysis = async () => {
    if (!errorInput.trim()) {
      setValidationError('Please provide the error message or stack trace.');
      return;
    }

    setValidationError('');
    setServerError(null);
    setWorkflowState('simulating');

    try {
      const created = await apiClient.startFixRun({
        error: errorInput,
        code: codeInput,
        fileName: fileName || undefined
      });

      setActiveRun(created);
      setSelectedRunId(created.id);
      setSelectedClaim(created.claims[0] || null);
      setWorkflowState('complete');
      void refreshRuns();
    } catch (err: any) {
      setServerError(err.message || 'An error occurred during diagnostic analysis.');
      setWorkflowState('input');
      void refreshRuns();
    }
  };

  const handleDecision = async (decision: 'approve' | 'reject') => {
    if (!activeRun || decisionPending || activeRun.status !== 'awaiting_approval') return;
    setDecisionPending(true);
    setServerError(null);
    try {
      await (decision === 'approve' ? approvePatch(activeRun.id) : rejectPatch(activeRun.id));
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to record the patch decision.');
    } finally {
      setDecisionPending(false);
    }
  };

  const handleNewAnalysis = () => {
    setSelectedRunId(null);
    setActiveRun(null);
    setDraftError('');
    setDraftCode('');
    setErrorInput('');
    setCodeInput('');
    setFileName('');
    setDraftFileName('');
    setValidationError('');
    setSelectedClaim(null);
    setServerError(null);
    setWorkflowState('input');
  };

  const handleRetry = () => {
    if (!activeRun) return;
    const error = activeRun.errorInput || '';
    const code = activeRun.codeInput || '';
    const name = activeRun.fileName || activeRun.patch?.filePath || '';
    setDraftError(error); setErrorInput(error);
    setDraftCode(code); setCodeInput(code);
    setDraftFileName(name); setFileName(name);
    setSelectedRunId(null); setActiveRun(null);
    setServerError(null); setValidationError('');
    setSelectedClaim(null); setWorkflowState('input');
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[#E3EAE6]">
        <div>
          <div className="text-xs font-semibold text-[#08775E] uppercase tracking-wider mb-1">
            Token-Efficient Coding Agent
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17201D]">
            {workflowState === 'complete' ? 'Run Analysis & Proposed Patch' : "Let's fix the issue."}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[#66736F]">
            {workflowState === 'complete'
              ? 'Review root-cause diagnosis, claim verification, and targeted diff.'
              : 'Share the error and any relevant code. PatchPilot will investigate and verify the proposed solution.'}
          </p>
        </div>

        {workflowState === 'complete' && (
          <button
            onClick={handleNewAnalysis}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#17201D] bg-white hover:bg-[#F8FAF9] rounded-lg border border-[#E3EAE6] transition-colors shadow-xs cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#66736F]" />
            <span>New Analysis</span>
          </button>
        )}
      </div>

      {(serverError || activeRun?.errorMessage) && (
        <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block mb-0.5">Operation Notice:</span>
            <span>{serverError || activeRun?.errorMessage}</span>
            {activeRun?.status === 'failed' && (
              <button onClick={handleRetry} className="block mt-2 font-semibold underline">Retry analysis</button>
            )}
          </div>
        </div>
      )}

      {/* STATE A: NEW ANALYSIS FORM */}
      {workflowState === 'input' && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white border border-[#E3EAE6] rounded-2xl p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#E3EAE6]">
              <span className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                Target Diagnostics
              </span>
              <button
                type="button"
                onClick={handleLoadSample}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#08775E] hover:text-[#065E4B] hover:underline cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Fill Sample Input</span>
              </button>
            </div>

            {/* Input 1: Error / stack trace */}
            <div className="space-y-1.5">
              <label htmlFor="error-input" className="block text-xs font-semibold text-[#17201D]">
                1. Error or Stack Trace <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="error-input"
                aria-invalid={!!validationError}
                aria-describedby={validationError ? 'error-validation' : undefined}
                value={errorInput}
                onChange={(e) => {
                  setErrorInput(e.target.value);
                  setDraftError(e.target.value);
                  if (validationError) setValidationError('');
                }}
                rows={4}
                placeholder="e.g. Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
                className="w-full text-xs font-mono text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-xl p-3.5 focus:outline-hidden focus:ring-2 focus:ring-[#08775E] focus:bg-white transition-all leading-relaxed"
              />
              {validationError && (
                <p id="error-validation" role="alert" className="text-xs text-rose-600 font-medium">{validationError}</p>
              )}
            </div>

            {/* Input 2: Relevant Code & File upload */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="code-input" className="block text-xs font-semibold text-[#17201D]">
                  2. Relevant Code Context <span className="text-[#66736F] font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <input
                    type="file"
                    id="file-upload"
                    accept=".py,.js,.ts,.tsx,.json,.txt"
                    onChange={handleFileUpload}
                    className="sr-only"
                  />
                  <label
                    htmlFor="file-upload"
                    className="inline-flex items-center gap-1 text-xs text-[#66736F] hover:text-[#17201D] cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload local file (.py, .ts, .js)</span>
                  </label>
                </div>
              </div>

              <div className="relative">
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#101816] rounded-t-xl text-[11px] font-mono text-[#E3EAE6] border-b border-slate-800">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <FileCode className="w-3.5 h-3.5 text-[#08775E]" />
                    {fileName || 'Untitled snippet'}
                  </span>
                  <span className="text-slate-500">Local context buffer</span>
                </div>
                <textarea
                  id="code-input"
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    setDraftCode(e.target.value);
                  }}
                  rows={8}
                  placeholder="# Paste code snippet or upload a file..."
                  className="w-full text-xs font-mono text-[#E3EAE6] bg-[#101816] rounded-b-xl p-3.5 focus:outline-hidden focus:ring-2 focus:ring-[#08775E] transition-all leading-relaxed"
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[#E3EAE6]">
              <div className="text-xs text-[#66736F]">
                Calls server-side Bifrost agent and Tavily claim verification.
              </div>
              <button
                type="button"
                onClick={handleStartAnalysis}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold text-white bg-[#08775E] hover:bg-[#065E4B] rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                <span>Analyze issue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATE B: ANALYSIS IN PROGRESS */}
      {workflowState === 'simulating' && (
        <div className="max-w-2xl mx-auto py-10">
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold text-[#17201D] mb-1">
              Dispatching Diagnostic Request
            </h3>
            <p className="text-xs text-[#66736F]">
              Server is analyzing error context, checking API claims against current sources, and generating patch.
            </p>
          </div>

          <RunTimeline
            steps={[
              { id: '1', label: 'Inspecting error', status: 'active', description: 'Extracting mismatch tokens' },
              { id: '2', label: 'Identifying relevant claims', status: 'pending', description: 'Querying endpoint contract' },
              { id: '3', label: 'Checking technical information', status: 'pending', description: 'Verifying with Tavily' },
              { id: '4', label: 'Preparing minimal patch', status: 'pending', description: 'Generating targeted substitution' },
              { id: '5', label: 'Reviewing test status', status: 'pending', description: 'Reporting available test results' },
              { id: '6', label: 'Ready for approval', status: 'pending', description: 'Packaging for developer sign-off' }
            ]}
            currentStepIndex={0}
            isProcessing={true}
          />
        </div>
      )}

      {/* STATE C: ANALYSIS COMPLETE */}
      {workflowState === 'complete' && activeRun && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Main Column (8 cols) */}
          <div className="lg:col-span-8 space-y-6">
            {/* Section 1: Diagnosis */}
            <div className="p-5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs">
              <div className="flex items-center gap-2 pb-3 mb-3 border-b border-[#E3EAE6]">
                <div className="w-2 h-2 rounded-full bg-[#08775E]" />
                <h3 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                  {activeRun.status === 'failed' ? 'Analysis Failed' : 'Diagnosis'}
                </h3>
              </div>
              <p className="text-sm text-[#17201D] leading-relaxed font-medium">
                {activeRun.diagnosis || (activeRun.status === 'failed' ? 'The analysis failed. Start a new analysis to retry.' : 'No diagnosis was returned.')}
              </p>
            </div>

            {/* Section 2: Verification of claims */}
            {activeRun.claims && activeRun.claims.length > 0 && (
              <div className="p-5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-[#E3EAE6]">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#08775E]" />
                    <h3 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                      Technical Claims Checked ({activeRun.claims.length})
                    </h3>
                  </div>
                  <span className="text-[11px] text-[#66736F]">
                    Tavily stale-answer engine
                  </span>
                </div>

                <div className="space-y-3">
                  {activeRun.claims.map((claim) => (
                    <ClaimCard
                      key={claim.id}
                      claim={claim}
                      isSelected={selectedClaim?.id === claim.id}
                      onSelect={() => setSelectedClaim(claim)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Section 3: Proposed Patch */}
            {activeRun.patch && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                    Proposed Minimal Patch
                  </h3>
                  <span className="text-xs text-[#66736F]">
                    Narrow diff · Lowest token footprint
                  </span>
                </div>
                <CodeDiff patch={activeRun.patch} />
              </div>
            )}

            {/* Section 4: Test Review */}
            <div className="p-5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#E3EAE6]">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-slate-500" />
                  <h3 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                    Automated Test Status
                  </h3>
                </div>
                <span className="text-[11px] font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                  {activeRun.tests.some((test) => test.status === 'failed') ? 'Failed' : activeRun.tests.some((test) => test.status === 'passed') ? 'Results available' : 'Not run'}
                </span>
              </div>

              <div className="space-y-2">
                {activeRun.tests.map((test) => (
                  <div key={test.id} className="p-3 rounded-lg bg-[#F8FAF9] border border-[#E3EAE6]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-[#17201D]">{test.name}</span>
                      <span className="text-[11px] font-medium text-slate-600 bg-slate-200/70 px-2 py-0.5 rounded">
                        {test.status === 'passed' ? 'Passed' : test.status === 'failed' ? 'Failed'
                          : test.status === 'skipped' ? 'Skipped' : 'Not run'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#66736F] leading-relaxed">
                      {test.output}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 5: Human Approval */}
            {activeRun.patch && (
              <div className="p-5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-semibold text-[#17201D] uppercase tracking-wider mb-1">
                      {activeRun.status === 'awaiting_approval' ? 'Human Approval Required' : 'Patch Decision'}
                    </h3>
                    <p className="text-xs text-[#66736F]">
                      Approval records your review only; it does not apply code or create a pull request.
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      onClick={() => handleDecision('reject')}
                      disabled={decisionPending || activeRun.status !== 'awaiting_approval'}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        activeRun.status === 'rejected'
                          ? 'bg-rose-50 text-rose-800 border-rose-200'
                          : 'bg-white text-[#17201D] border-[#E3EAE6] hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                      }`}
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{activeRun.status === 'rejected' ? 'Rejected' : 'Reject patch'}</span>
                    </button>

                    <button
                      onClick={() => handleDecision('approve')}
                      disabled={decisionPending || activeRun.status !== 'awaiting_approval'}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors shadow-xs cursor-pointer ${
                        activeRun.status === 'approved'
                          ? 'bg-emerald-600 text-white cursor-default'
                          : 'bg-[#08775E] hover:bg-[#065E4B] text-white'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{activeRun.status === 'approved' ? 'Approved' : decisionPending ? 'Saving…' : 'Approve patch'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Context Panel (4 cols) */}
          <div className="lg:col-span-4 space-y-6">
            {/* Run Overview */}
            <div className="p-5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#E3EAE6]">
                <span className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                  Run Overview
                </span>
                <RunStatusBadge status={activeRun.status} />
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between text-[#66736F]">
                  <span>Run ID:</span>
                  <span className="font-mono text-[#17201D]">{activeRun.id}</span>
                </div>
                <div className="flex items-center justify-between text-[#66736F]">
                  <span>Claims Checked:</span>
                  <span className="font-semibold text-[#17201D]">
                    {activeRun.claims.length}
                  </span>
                </div>
              </div>

              <BudgetIndicator
                currentTokens={activeRun.usage.totalTokens}
                maxTokens={settings.budgetMaxTokens}
              />
            </div>

            {/* Efficiency metrics */}
            <div className="p-5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs">
              <UsageSummary usage={activeRun.usage} />
            </div>

            {/* Model & Routing */}
            <div className="p-5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-[#E3EAE6]">
                <Server className="w-4 h-4 text-[#08775E]" />
                <span className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                  Model Routing
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between text-[#66736F]">
                  <span>Gateway Status:</span>
                  <span className="font-medium text-[#17201D]">
                    {health?.integrations?.bifrost?.configured ? 'Configured' : 'Integration required'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[#66736F]">
                  <span>Tavily Status:</span>
                  <span className="font-medium text-[#17201D]">
                    {health?.integrations?.tavily?.configured ? 'Configured' : 'Integration required'}
                  </span>
                </div>
              </div>
            </div>

            {/* Claim Evidence Inspector (contextual) */}
            {selectedClaim && (
              <EvidencePanel
                claim={selectedClaim}
                onClose={() => setSelectedClaim(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
