import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Run, AppSettings } from '../types/domain';
import { apiClient, BackendHealth } from '../services/apiClient';

export type NavigationPage = 'overview' | 'fix_code' | 'verify_answer' | 'runs' | 'settings';

const SETTINGS_KEY = 'patchpilot_client_settings_v2';

const DEFAULT_SETTINGS: AppSettings = {
  workspaceName: 'Acme Engineering',
  defaultLandingPage: 'overview',
  budgetMaxCost: 0.50,
  budgetMaxTokens: 15000,
  budgetWarningThreshold: 80,
  requireApprovalPatches: true,
  requireApprovalCommands: true,
  readOnlyAnalysisDefault: true
};

interface AppContextType {
  activePage: NavigationPage;
  setActivePage: (page: NavigationPage) => void;
  runs: Run[];
  loadingRuns: boolean;
  runsError: string | null;
  health: BackendHealth | null;
  loadingHealth: boolean;
  healthError: string | null;
  settings: AppSettings;
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
  draftError: string;
  setDraftError: (err: string) => void;
  draftCode: string;
  setDraftCode: (code: string) => void;
  draftFileName: string;
  setDraftFileName: (name: string) => void;
  draftAnswer: string;
  setDraftAnswer: (ans: string) => void;
  navigateTo: (page: NavigationPage, options?: { runId?: string; draftError?: string; draftAnswer?: string }) => void;
  refreshRuns: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  approvePatch: (runId: string) => Promise<void>;
  rejectPatch: (runId: string) => Promise<void>;
}

// Preserve context identity across Vite hot updates of the provider and consumers.
const AppContext: React.Context<AppContextType | undefined> =
  import.meta.hot?.data.appContext || createContext<AppContextType | undefined>(undefined);
if (import.meta.hot) import.meta.hot.data.appContext = AppContext;

export function AppProvider({ children }: { children: ReactNode }) {
  const [activePage, setActivePage] = useState<NavigationPage>('overview');
  const [runs, setRuns] = useState<Run[]>([]);
  const [loadingRuns, setLoadingRuns] = useState<boolean>(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [loadingHealth, setLoadingHealth] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return {
            ...DEFAULT_SETTINGS,
            workspaceName: typeof parsed.workspaceName === 'string' && parsed.workspaceName.trim()
              ? parsed.workspaceName.trim().slice(0, 100)
              : DEFAULT_SETTINGS.workspaceName,
            defaultLandingPage: ['overview', 'fix_code', 'verify_answer', 'runs'].includes(parsed.defaultLandingPage)
              ? parsed.defaultLandingPage
              : DEFAULT_SETTINGS.defaultLandingPage
          };
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string>('');
  const [draftCode, setDraftCode] = useState<string>('');
  const [draftFileName, setDraftFileName] = useState('');
  const [draftAnswer, setDraftAnswer] = useState<string>('');

  useEffect(() => {
    setActivePage(settings.defaultLandingPage);
  }, []);

  const refreshHealth = async () => {
    setLoadingHealth(true);
    setHealthError(null);
    try {
      const h = await apiClient.getHealth();
      setHealth(h);
      if (h.budgets) {
        setSettings((prev) => ({
          ...prev,
          budgetMaxCost: h.budgets.maxCostPerRunUsd,
          budgetMaxTokens: h.budgets.maxTokensPerRun
        }));
      }
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : 'Unable to check server health.');
    } finally {
      setLoadingHealth(false);
    }
  };

  const refreshRuns = async () => {
    setLoadingRuns(true);
    setRunsError(null);
    try {
      const fetched = await apiClient.listRuns();
      setRuns(fetched);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : 'Unable to load runs.');
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    refreshHealth();
    refreshRuns();
  }, []);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    // Persist before updating the UI so a failed save cannot report success.
    const updated = { ...settings, ...newSettings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    setSettings((prev) => {
      return { ...prev, ...newSettings };
    });
  };

  const approvePatch = async (runId: string) => {
    const updated = await apiClient.approvePatch(runId);
    setRuns((prev) => prev.map((run) => run.id === runId ? updated : run));
  };

  const rejectPatch = async (runId: string) => {
    const updated = await apiClient.rejectPatch(runId);
    setRuns((prev) => prev.map((run) => run.id === runId ? updated : run));
  };

  const navigateTo = (
    page: NavigationPage,
    options?: { runId?: string; draftError?: string; draftAnswer?: string }
  ) => {
    if (options?.runId !== undefined) {
      setSelectedRunId(options.runId);
    } else if (page !== activePage) {
      setSelectedRunId(null);
    }
    if (options?.draftError !== undefined) {
      setDraftError(options.draftError);
    }
    if (options?.draftAnswer !== undefined) {
      setDraftAnswer(options.draftAnswer);
    }
    setActivePage(page);
    document.getElementById('app-main')?.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <AppContext.Provider
      value={{
        activePage,
        setActivePage,
        runs,
        loadingRuns,
        runsError,
        health,
        loadingHealth,
        healthError,
        settings,
        selectedRunId,
        setSelectedRunId,
        draftError,
        setDraftError,
        draftCode,
        setDraftCode,
        draftFileName,
        setDraftFileName,
        draftAnswer,
        setDraftAnswer,
        navigateTo,
        refreshRuns,
        refreshHealth,
        updateSettings,
        approvePatch,
        rejectPatch
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
