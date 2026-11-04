import {
  Run,
  RunType,
  RunStatus,
  AppSettings,
  TokenUsage,
  WorkflowStep
} from '../types/domain';
import {
  INITIAL_RUNS,
  DEFAULT_SETTINGS,
  SAMPLE_CODE_FIX_CLAIMS,
  SAMPLE_CODE_PATCH,
  SAMPLE_TEST_RESULTS,
  SAMPLE_VERIFY_ANSWER_CLAIMS
} from '../data/demoFixtures';

const RUNS_STORAGE_KEY = 'patchpilot_runs_v1';
const SETTINGS_STORAGE_KEY = 'patchpilot_settings_v1';

export interface IPatchPilotService {
  startFixRun(input: { error: string; code?: string; fileName?: string }): Promise<Run>;
  verifyAnswer(input: { text: string }): Promise<Run>;
  getRun(runId: string): Promise<Run | undefined>;
  listRuns(filters?: { type?: RunType | 'all'; status?: RunStatus | 'all'; search?: string }): Promise<Run[]>;
  approvePatch(runId: string): Promise<Run>;
  rejectPatch(runId: string): Promise<Run>;
  getUsage(runId: string): Promise<TokenUsage | undefined>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  resetToDemoData(): Promise<void>;
}

class MockPatchPilotService implements IPatchPilotService {
  private getStoredRuns(): Run[] {
    try {
      const stored = localStorage.getItem(RUNS_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to parse stored runs, using initial fixtures', e);
    }
    return INITIAL_RUNS;
  }

  private saveStoredRuns(runs: Run[]): void {
    try {
      localStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(runs));
    } catch (e) {
      console.warn('Failed to save runs to localStorage', e);
    }
  }

  async listRuns(filters?: { type?: RunType | 'all'; status?: RunStatus | 'all'; search?: string }): Promise<Run[]> {
    let runs = this.getStoredRuns();

    if (filters?.type && filters.type !== 'all') {
      runs = runs.filter((r) => r.type === filters.type);
    }

    if (filters?.status && filters.status !== 'all') {
      runs = runs.filter((r) => r.status === filters.status);
    }

    if (filters?.search && filters.search.trim()) {
      const term = filters.search.toLowerCase();
      runs = runs.filter(
        (r) =>
          r.title.toLowerCase().includes(term) ||
          (r.diagnosis && r.diagnosis.toLowerCase().includes(term)) ||
          (r.errorInput && r.errorInput.toLowerCase().includes(term))
      );
    }

    return runs;
  }

  async getRun(runId: string): Promise<Run | undefined> {
    const runs = this.getStoredRuns();
    return runs.find((r) => r.id === runId);
  }

  async startFixRun(input: { error: string; code?: string; fileName?: string }): Promise<Run> {
    const runs = this.getStoredRuns();
    const id = `run-cf-${Date.now()}`;
    const now = new Date().toISOString();

    const isSampleCase = input.error.toLowerCase().includes('max_tokens');

    const steps: WorkflowStep[] = [
      { id: 'step-1', label: 'Inspecting error', status: 'completed', description: 'Extracted error signature' },
      { id: 'step-2', label: 'Identifying relevant claims', status: 'completed', description: 'Extracted parameter contract claims' },
      { id: 'step-3', label: 'Checking technical information', status: 'completed', description: 'Verified against provider specifications' },
      { id: 'step-4', label: 'Preparing minimal patch', status: 'completed', description: 'Generated targeted parameter change' },
      { id: 'step-5', label: 'Reviewing simulated tests', status: 'completed', description: 'Executed syntax and signature checks' },
      { id: 'step-6', label: 'Ready for approval', status: 'completed', description: 'Awaiting developer sign-off' }
    ];

    const newRun: Run = {
      id,
      title: input.fileName ? `Fix ${input.fileName}` : `Fix issue: ${input.error.slice(0, 48)}...`,
      type: 'code_fix',
      status: 'awaiting_approval',
      createdAt: now,
      updatedAt: now,
      errorInput: input.error,
      codeInput: input.code || '',
      diagnosis: isSampleCase
        ? "The request uses a parameter ('max_tokens') that the selected demo model does not accept. Compatibility depends on provider, model, and API version."
        : "Identified compatibility issue in parameter invocation. Proposed fix provides localized replacement conforming to the target API specification.",
      steps,
      claims: isSampleCase ? SAMPLE_CODE_FIX_CLAIMS : [
        {
          id: `claim-${Date.now()}-1`,
          text: "Parameter invocation requires current API naming convention.",
          status: 'outdated',
          explanation: "The supplied error indicates the invoked parameter signature is obsolete or incompatible with this specific endpoint target.",
          suggestedCorrection: "Update parameter to target modern endpoint definition.",
          freshnessSensitive: true,
          sources: [
            {
              id: `src-${Date.now()}-1`,
              title: 'API Specification Reference (Sample)',
              publisher: 'Developer Documentation (Sample)',
              publishedAt: '2026-04-01',
              retrievedAt: '2026-11-03',
              excerpt: 'Parameters must adhere to current schema revision.',
              isDemoSource: true
            }
          ]
        }
      ],
      patch: isSampleCase
        ? SAMPLE_CODE_PATCH
        : {
            id: `patch-${Date.now()}`,
            filePath: input.fileName || 'source_file.ts',
            originalCode: input.code || input.error,
            proposedCode: (input.code || input.error).replace(/max_tokens/g, 'max_completion_tokens'),
            explanation: "Targeted single-element substitution to align with current API specification.",
            approvalStatus: 'pending'
          },
      tests: SAMPLE_TEST_RESULTS,
      usage: {
        inputTokens: 395,
        outputTokens: 92,
        totalTokens: 487,
        estimatedCost: 0.0014,
        currency: 'USD',
        simulated: true
      }
    };

    const updated = [newRun, ...runs];
    this.saveStoredRuns(updated);
    return newRun;
  }

  async verifyAnswer(input: { text: string }): Promise<Run> {
    const runs = this.getStoredRuns();
    const id = `run-va-${Date.now()}`;
    const now = new Date().toISOString();

    const isSampleAnswer = input.text.includes('DemoClient') || input.text.includes('max_tokens');

    const steps: WorkflowStep[] = [
      { id: 'step-1', label: 'Extract claims', status: 'completed', description: 'Extracted 3 factual claims' },
      { id: 'step-2', label: 'Assess freshness sensitivity', status: 'completed', description: 'Assessed version sensitivity per claim' },
      { id: 'step-3', label: 'Review sample evidence', status: 'completed', description: 'Matched against local demo evidence fixtures' },
      { id: 'step-4', label: 'Classify claims', status: 'completed', description: 'Assigned verified, outdated, and uncertain states' },
      { id: 'step-5', label: 'Produce report', status: 'completed', description: 'Generated structured verification cards' }
    ];

    const claims = isSampleAnswer ? SAMPLE_VERIFY_ANSWER_CLAIMS : [
      {
        id: `claim-custom-1`,
        text: input.text.slice(0, 90) + '...',
        status: 'outdated' as const,
        explanation: 'This claim references an API behavior or parameter convention that was updated in recent revisions.',
        suggestedCorrection: 'Verify current SDK release documentation before deploying.',
        freshnessSensitive: true,
        sources: [
          {
            id: `src-custom-1`,
            title: 'Sample Developer Guideline Reference',
            publisher: 'API Changelog (Sample)',
            publishedAt: '2026-03-01',
            retrievedAt: '2026-11-03',
            excerpt: 'Subject to version-specific deprecation schedule.',
            isDemoSource: true
          }
        ]
      },
      {
        id: `claim-custom-2`,
        text: 'Core authentication credentials remain standard.',
        status: 'verified' as const,
        explanation: 'Standard token or key-based authorization is retained across supported SDK generations.',
        sources: []
      },
      {
        id: `claim-custom-3`,
        text: 'Latency and throughput guarantees under peak load.',
        status: 'uncertain' as const,
        explanation: 'Insufficient public documentation available to verify dynamic performance thresholds.',
        sources: []
      }
    ];

    const newRun: Run = {
      id,
      title: `Verify: ${input.text.slice(0, 48).trim()}...`,
      type: 'answer_verification',
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      answerInput: input.text,
      steps,
      claims,
      tests: [],
      usage: {
        inputTokens: 310,
        outputTokens: 135,
        totalTokens: 445,
        estimatedCost: 0.0013,
        currency: 'USD',
        simulated: true
      }
    };

    const updated = [newRun, ...runs];
    this.saveStoredRuns(updated);
    return newRun;
  }

  async approvePatch(runId: string): Promise<Run> {
    const runs = this.getStoredRuns();
    const index = runs.findIndex((r) => r.id === runId);
    if (index === -1) {
      throw new Error(`Run not found: ${runId}`);
    }

    const run = runs[index];
    const updatedPatch = run.patch ? { ...run.patch, approvalStatus: 'approved' as const } : undefined;

    const updatedRun: Run = {
      ...run,
      status: 'approved',
      updatedAt: new Date().toISOString(),
      patch: updatedPatch
    };

    runs[index] = updatedRun;
    this.saveStoredRuns(runs);
    return updatedRun;
  }

  async rejectPatch(runId: string): Promise<Run> {
    const runs = this.getStoredRuns();
    const index = runs.findIndex((r) => r.id === runId);
    if (index === -1) {
      throw new Error(`Run not found: ${runId}`);
    }

    const run = runs[index];
    const updatedPatch = run.patch ? { ...run.patch, approvalStatus: 'rejected' as const } : undefined;

    const updatedRun: Run = {
      ...run,
      status: 'rejected',
      updatedAt: new Date().toISOString(),
      patch: updatedPatch
    };

    runs[index] = updatedRun;
    this.saveStoredRuns(runs);
    return updatedRun;
  }

  async getUsage(runId: string): Promise<TokenUsage | undefined> {
    const run = await this.getRun(runId);
    return run?.usage;
  }

  async getSettings(): Promise<AppSettings> {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Failed to parse stored settings', e);
    }
    return DEFAULT_SETTINGS;
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to save settings', e);
    }
    return updated;
  }

  async resetToDemoData(): Promise<void> {
    localStorage.setItem(RUNS_STORAGE_KEY, JSON.stringify(INITIAL_RUNS));
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
  }
}

export const patchPilotService = new MockPatchPilotService();
