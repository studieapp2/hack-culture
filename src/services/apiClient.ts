import { Run, AppSettings, RunType, RunStatus } from '../types/domain';

export interface BackendHealth {
  status: 'healthy' | 'degraded' | 'unconfigured';
  timestamp: string;
  version: string;
  integrations: {
    tavily: {
      configured: boolean;
      status: string;
      details?: string;
      error?: string;
    };
    bifrost: {
      configured: boolean;
      status: string;
      details?: string;
      error?: string;
    };
  };
  budgets: {
    maxTokensPerRun: number;
    maxCostPerRunUsd: number;
    maxModelCallsPerRun: number;
    maxSearchesPerRun: number;
  };
}

class ApiClient {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      }
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData?.message) errorMessage = errorData.message;
        else if (errorData?.error) errorMessage = errorData.error;
      } catch {
        // use status text
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  async getHealth(): Promise<BackendHealth> {
    return this.request<BackendHealth>('/api/health');
  }

  async listRuns(filters?: { type?: RunType | 'all'; status?: RunStatus | 'all'; search?: string }): Promise<Run[]> {
    const params = new URLSearchParams();
    if (filters?.type && filters.type !== 'all') params.append('type', filters.type);
    if (filters?.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);

    const query = params.toString() ? `?${params.toString()}` : '';
    const serverRuns: any[] = await this.request<any[]>(`/api/runs${query}`);
    return serverRuns.map(this.normalizeServerRun);
  }

  async getRun(runId: string): Promise<Run | undefined> {
    try {
      const serverRun = await this.request<any>(`/api/runs/${runId}`);
      return this.normalizeServerRun(serverRun);
    } catch {
      return undefined;
    }
  }

  async startFixRun(input: { error: string; code?: string; fileName?: string }): Promise<Run> {
    const serverRun = await this.request<any>('/api/fix/analyze', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return this.normalizeServerRun(serverRun);
  }

  async verifyAnswer(input: { text: string }): Promise<Run> {
    const serverRun = await this.request<any>('/api/verify', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return this.normalizeServerRun(serverRun);
  }

  async approvePatch(runId: string): Promise<Run> {
    const serverRun = await this.request<any>(`/api/runs/${runId}/approve`, {
      method: 'POST'
    });
    return this.normalizeServerRun(serverRun);
  }

  async rejectPatch(runId: string): Promise<Run> {
    const serverRun = await this.request<any>(`/api/runs/${runId}/reject`, {
      method: 'POST'
    });
    return this.normalizeServerRun(serverRun);
  }

  /**
   * Normalizes server types to domain client types
   */
  private normalizeServerRun(s: any): Run {
    let clientStatus: RunStatus = 'completed';
    const rawStatus = (s.status || '').toLowerCase();

    if (rawStatus === 'awaiting_approval' || rawStatus === 'patch_ready') {
      clientStatus = 'awaiting_approval';
    } else if (rawStatus === 'approved') {
      clientStatus = 'approved';
    } else if (rawStatus === 'rejected') {
      clientStatus = 'rejected';
    } else if (rawStatus === 'failed') {
      clientStatus = 'failed';
    } else if (rawStatus === 'analyzing' || rawStatus === 'verifying' || rawStatus === 'queued') {
      clientStatus = 'in_progress';
    } else {
      clientStatus = 'completed';
    }

    return {
      id: s.id,
      title: s.title,
      type: s.type,
      status: clientStatus,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      errorInput: s.errorInput,
      codeInput: s.codeInput,
      answerInput: s.answerInput,
      diagnosis: s.diagnosis,
      steps: s.steps || [],
      claims: (s.claims || []).map((c: any) => ({
        id: c.id,
        text: c.originalText || c.text,
        status: (c.status || '').toLowerCase() === 'verified'
          ? 'verified'
          : (c.status || '').toLowerCase() === 'outdated'
          ? 'outdated'
          : 'uncertain',
        explanation: c.explanation,
        sources: (c.sources || []).map((src: any) => ({
          id: src.id,
          title: src.title,
          url: src.url,
          publisher: src.publisher,
          publishedAt: src.publishedAt,
          retrievedAt: src.retrievedAt,
          excerpt: src.excerpt,
          isDemoSource: false
        })),
        suggestedCorrection: c.suggestedCorrection,
        freshnessSensitive: c.freshnessSensitive
      })),
      patch: s.patch,
      tests: (s.tests || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        status: t.status === 'passed' ? 'passed' : t.status === 'failed' ? 'failed' : 'skipped',
        output: t.output || t.reason || 'Not run',
        simulated: false
      })),
      usage: {
        inputTokens: s.usage?.inputTokens || 0,
        outputTokens: s.usage?.outputTokens || 0,
        totalTokens: s.usage?.totalTokens || 0,
        estimatedCost: s.usage?.estimatedCost || 0,
        currency: s.usage?.currency || 'USD',
        simulated: false
      }
    };
  }
}

export const apiClient = new ApiClient();
