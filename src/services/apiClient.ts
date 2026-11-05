import { Run, RunType, RunStatus } from '../types/domain';
import { normalizeUsage } from './usage';

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
    const workflow = endpoint === '/api/fix/analyze' || endpoint === '/api/verify';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), workflow ? 110000 : 20000);
    try {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {})
        }
      });
    } catch {
      throw new Error(controller.signal.aborted
        ? workflow ? 'Request timed out. Check Runs before retrying; the server may still be finishing the run.' :
          'The server took too long to respond. Please retry.'
        : 'Unable to reach the server. Check your connection and try again.');
    }

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

    try {
      return await response.json();
    } catch {
      throw new Error('The server returned an unreadable response. Please try again.');
    }
    } finally {
      clearTimeout(timeout);
    }
  }

  async getHealth(): Promise<BackendHealth> {
    return this.request<BackendHealth>('/api/health');
  }

  async getReadiness(): Promise<{ status: 'ready' }> {
    const result = await this.request<{ status?: unknown }>('/api/ready');
    if (result?.status !== 'ready') {
      throw new Error('The server returned an invalid readiness response.');
    }
    return { status: 'ready' };
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
    const serverRun = await this.request<any>(`/api/runs/${encodeURIComponent(runId)}`);
    return this.normalizeServerRun(serverRun);
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
    const serverRun = await this.request<any>(`/api/runs/${encodeURIComponent(runId)}/approve`, {
      method: 'POST'
    });
    return this.normalizeServerRun(serverRun);
  }

  async rejectPatch(runId: string): Promise<Run> {
    const serverRun = await this.request<any>(`/api/runs/${encodeURIComponent(runId)}/reject`, {
      method: 'POST'
    });
    return this.normalizeServerRun(serverRun);
  }

  /**
   * Normalizes server types to domain client types
   */
  private normalizeServerRun(s: any): Run {
    if (!s || typeof s !== 'object' || Array.isArray(s) ||
      typeof s.id !== 'string' || typeof s.title !== 'string' ||
      !['code_fix', 'answer_verification'].includes(s.type) ||
      typeof s.createdAt !== 'string' || typeof s.updatedAt !== 'string' ||
      (s.diagnosis !== undefined && typeof s.diagnosis !== 'string')) {
      throw new Error('The server returned an invalid run record. No successful result was inferred.');
    }
    let clientStatus: RunStatus = 'unknown';
    const rawStatus = typeof s.status === 'string' ? s.status.toLowerCase() : '';

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
    } else if (rawStatus === 'completed') {
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
      fileName: s.fileName,
      errorMessage: s.errorMessage,
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
        status: t.status === 'passed' ? 'passed' : t.status === 'failed' ? 'failed'
          : t.status === 'skipped' ? 'skipped' : 'not_run',
        output: t.output || t.reason || 'Not run',
        reason: typeof t.reason === 'string' ? t.reason : undefined,
        simulated: false
      })),
      usage: normalizeUsage(s.usage)
    };
  }
}

export const apiClient = new ApiClient();
