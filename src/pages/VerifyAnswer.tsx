import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { apiClient } from '../services/apiClient';
import { Run, Claim } from '../types/domain';
import { SAMPLE_ANSWER_INPUT } from '../data/demoFixtures';
import { ClaimCard } from '../components/verification/ClaimCard';
import { EvidencePanel } from '../components/verification/EvidencePanel';
import { VerificationSummary } from '../components/verification/VerificationSummary';
import { RunTimeline } from '../components/runs/RunTimeline';
import { UsageSummary } from '../components/shared/UsageSummary';
import {
  ShieldCheck,
  Sparkles,
  RotateCcw,
  Trash2,
  AlertCircle
} from 'lucide-react';

export function VerifyAnswer() {
  const {
    runs,
    selectedRunId,
    setSelectedRunId,
    draftAnswer,
    setDraftAnswer,
    refreshRuns
  } = useApp();

  const [inputText, setInputText] = useState(draftAnswer || '');
  const [validationError, setValidationError] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState<'input' | 'simulating' | 'complete'>('input');
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);

  useEffect(() => {
    if (selectedRunId) {
      const existing = runs.find((r) => r.id === selectedRunId);
      if (existing && existing.type === 'answer_verification') {
        setActiveRun(existing);
        setWorkflowState('complete');
        if (existing.claims.length > 0) {
          setSelectedClaim(existing.claims[0]);
        }
      }
    } else if (draftAnswer) {
      setInputText(draftAnswer);
    }
  }, [selectedRunId, runs, draftAnswer]);

  const handleLoadSample = () => {
    setInputText(SAMPLE_ANSWER_INPUT);
    setValidationError('');
    setServerError(null);
  };

  const handleClear = () => {
    setInputText('');
    setDraftAnswer('');
    setValidationError('');
    setServerError(null);
  };

  const handleStartVerification = async () => {
    if (!inputText.trim()) {
      setValidationError('Please paste an answer or explanation to extract and verify claims.');
      return;
    }

    setValidationError('');
    setServerError(null);
    setWorkflowState('simulating');

    try {
      const created = await apiClient.verifyAnswer({ text: inputText });
      await refreshRuns();
      setActiveRun(created);
      setSelectedRunId(created.id);
      if (created.claims.length > 0) {
        setSelectedClaim(created.claims[0]);
      }
      setWorkflowState('complete');
    } catch (err: any) {
      setServerError(err.message || 'An error occurred during verification.');
      setWorkflowState('input');
    }
  };

  const handleNewCheck = () => {
    setSelectedRunId(null);
    setActiveRun(null);
    setDraftAnswer('');
    setInputText('');
    setServerError(null);
    setWorkflowState('input');
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[#E3EAE6]">
        <div>
          <div className="text-xs font-semibold text-[#08775E] uppercase tracking-wider mb-1">
            Tavily Stale-Answer Detection
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17201D]">
            {workflowState === 'complete' ? 'Claim Verification Dossier' : 'Is this answer still accurate?'}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[#66736F]">
            Find outdated claims in AI-generated answers before you rely on them.
          </p>
        </div>

        {workflowState === 'complete' && (
          <button
            onClick={handleNewCheck}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#17201D] bg-white hover:bg-[#F8FAF9] rounded-lg border border-[#E3EAE6] transition-colors shadow-xs cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#66736F]" />
            <span>Verify Another Answer</span>
          </button>
        )}
      </div>

      {serverError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block mb-0.5">Verification Notice:</span>
            <span>{serverError}</span>
          </div>
        </div>
      )}

      {/* STATE A: INPUT */}
      {workflowState === 'input' && (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white border border-[#E3EAE6] rounded-2xl p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#E3EAE6]">
              <span className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                Target Passage / Technical Advice
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#08775E] hover:text-[#065E4B] hover:underline cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Fill Sample Answer</span>
                </button>
                {inputText && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="inline-flex items-center gap-1 text-xs text-[#66736F] hover:text-rose-600 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>

            <div>
              <textarea
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (validationError) setValidationError('');
                }}
                rows={6}
                placeholder="Paste an AI-generated answer to check its claims..."
                className="w-full text-xs font-mono sm:text-sm text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-xl p-4 focus:outline-hidden focus:ring-2 focus:ring-[#08775E] focus:bg-white transition-all resize-y leading-relaxed"
              />
              {validationError && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-600 font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{validationError}</span>
                </div>
              )}
            </div>

            <div className="pt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[#E3EAE6]">
              <span className="text-xs text-[#66736F]">
                Extracts factual claims and cross-references authoritative sources via Tavily.
              </span>

              <button
                type="button"
                onClick={handleStartVerification}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-semibold text-white bg-[#08775E] hover:bg-[#065E4B] rounded-lg transition-colors shadow-xs cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Verify claims</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATE B: PROCESSING */}
      {workflowState === 'simulating' && (
        <div className="max-w-2xl mx-auto py-10">
          <div className="text-center mb-8">
            <h3 className="text-xl font-bold text-[#17201D] mb-1">
              Verifying Factual Claims
            </h3>
            <p className="text-xs text-[#66736F]">
              Server is extracting verifiable statements and performing Tavily source lookups.
            </p>
          </div>

          <RunTimeline
            steps={[
              { id: '1', label: 'Extract claims', status: 'active', description: 'Decomposing text into atomic assertions' },
              { id: '2', label: 'Assess freshness sensitivity', status: 'pending', description: 'Checking version and deprecation flags' },
              { id: '3', label: 'Retrieve authoritative evidence', status: 'pending', description: 'Querying Tavily Search' },
              { id: '4', label: 'Evaluate claims against evidence', status: 'pending', description: 'Classifying verified, outdated, and uncertain claims' },
              { id: '5', label: 'Compile verification dossier', status: 'pending', description: 'Structuring source references' }
            ]}
            currentStepIndex={0}
            isProcessing={true}
          />
        </div>
      )}

      {/* STATE C: COMPLETE */}
      {workflowState === 'complete' && activeRun && (
        <div className="space-y-6">
          {/* Summary stats strip */}
          <VerificationSummary claims={activeRun.claims} />

          {/* Two-column layout: Claims List on Left, Evidence Inspector on Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left: Claim List (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#17201D] uppercase tracking-wider">
                  Extracted Claims ({activeRun.claims.length})
                </span>
                <span className="text-xs text-[#66736F]">
                  Click claim to inspect dossier
                </span>
              </div>

              {activeRun.claims.length === 0 ? (
                <div className="p-8 bg-white border border-[#E3EAE6] rounded-xl text-center text-xs text-[#66736F]">
                  No verifiable factual assertions were extracted from the input.
                </div>
              ) : (
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
              )}

              {/* Usage telemetry */}
              <div className="p-4 bg-white border border-[#E3EAE6] rounded-xl shadow-xs mt-6">
                <UsageSummary usage={activeRun.usage} />
              </div>
            </div>

            {/* Right: Evidence Panel (5 cols) */}
            <div className="lg:col-span-5 sticky top-20">
              <EvidencePanel
                claim={selectedClaim}
                onClose={() => setSelectedClaim(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
