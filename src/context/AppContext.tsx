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
  health: BackendHealth | null;
  loadingHealth: boolean;
  settings: AppSettings;
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
  draftError: string;
  setDraftError: (err: string) => void;
  draftCode: string;
  setDraftCode: (code: string) => void;
  draftAnswer: string;
  setDraftAnswer: (ans: string) => void;
  navigateTo: (page: NavigationPage, options?: { runId?: string; draftError?: string; draftAnswer?: string }) => void;
  refreshRuns: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  approvePatch: (runId: string) => Promise<void>;
  rejectPatch: (runId: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [activePage, setActivePage] = useState<NavigationPage>('overview');
  const [runs, setRuns] = useState<Run[]>([]);
  const [loadingRuns, setLoadingRuns] = useState<boolean>(true);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [loadingHealth, setLoadingHealth] = useState<boolean>(true);
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string>('');
  const [draftCode, setDraftCode] = useState<string>('');
  const [draftAnswer, setDraftAnswer] = useState<string>('');

  const refreshHealth = async () => {
    setLoadingHealth(true);
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
      console.warn('Backend health check failed:', err);
    } finally {
      setLoadingHealth(false);
    }
  };

  const refreshRuns = async () => {
    setLoadingRuns(true);
    try {
      const fetched = await apiClient.listRuns();
      setRuns(fetched);
    } catch (err) {
      console.warn('Failed to fetch runs from backend:', err);
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    refreshHealth();
    refreshRuns();
  }, []);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const approvePatch = async (runId: string) => {
    await apiClient.approvePatch(runId);
    await refreshRuns();
  };

  const rejectPatch = async (runId: string) => {
    await apiClient.rejectPatch(runId);
    await refreshRuns();
  };

  const navigateTo = (
    page: NavigationPage,
    options?: { runId?: string; draftError?: string; draftAnswer?: string }
  ) => {
    if (options?.runId !== undefined) {
      setSelectedRunId(options.runId);
    }
    if (options?.draftError !== undefined) {
      setDraftError(options.draftError);
    }
    if (options?.draftAnswer !== undefined) {
      setDraftAnswer(options.draftAnswer);
    }
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <AppContext.Provider
      value={{
        activePage,
        setActivePage,
        runs,
        loadingRuns,
        health,
        loadingHealth,
        settings,
        selectedRunId,
        setSelectedRunId,
        draftError,
        setDraftError,
        draftCode,
        setDraftCode,
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
