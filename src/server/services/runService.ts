import { ServerRun, RunType, RunState, CodePatch } from '../types';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const RUNS_FILE = path.join(DATA_DIR, 'runs.json');

export class RunService {
  private runs: Map<string, ServerRun> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(RUNS_FILE)) {
        const raw = fs.readFileSync(RUNS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const run of parsed) {
            this.runs.set(run.id, run);
          }
        }
      }
    } catch (err: any) {
      console.warn('Could not load runs from disk:', err?.message);
    }
  }

  private saveToDisk(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const array = Array.from(this.runs.values());
      fs.writeFileSync(RUNS_FILE, JSON.stringify(array, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn('Could not persist runs to disk:', err?.message);
    }
  }

  public createRun(
    type: RunType,
    title: string,
    initialData: Partial<ServerRun> = {}
  ): ServerRun {
    const id = `run-${type === 'code_fix' ? 'cf' : 'va'}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const run: ServerRun = {
      id,
      title,
      type,
      status: 'QUEUED',
      createdAt: now,
      updatedAt: now,
      steps: [],
      claims: [],
      tests: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        currency: 'USD',
        isMeasured: false,
        model: 'unspecified',
        latencyMs: 0
      },
      ...initialData
    };

    this.runs.set(id, run);
    this.saveToDisk();
    return run;
  }

  public getRun(id: string): ServerRun | undefined {
    return this.runs.get(id);
  }

  public listRuns(filters?: { type?: RunType | 'all'; status?: RunState | 'all'; search?: string }): ServerRun[] {
    let list = Array.from(this.runs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (filters?.type && filters.type !== 'all') {
      list = list.filter((r) => r.type === filters.type);
    }

    if (filters?.status && filters.status !== 'all') {
      list = list.filter((r) => r.status === filters.status);
    }

    if (filters?.search && filters.search.trim()) {
      const term = filters.search.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(term) ||
          r.diagnosis?.toLowerCase().includes(term) ||
          r.errorInput?.toLowerCase().includes(term)
      );
    }

    return list;
  }

  public updateRun(id: string, updates: Partial<ServerRun>): ServerRun {
    const existing = this.runs.get(id);
    if (!existing) {
      throw new Error(`Run not found: ${id}`);
    }

    const updated: ServerRun = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    this.runs.set(id, updated);
    this.saveToDisk();
    return updated;
  }

  public approveRun(id: string): ServerRun {
    const existing = this.runs.get(id);
    if (!existing) {
      throw new Error(`Run not found: ${id}`);
    }

    if (existing.status !== 'AWAITING_APPROVAL' && existing.status !== 'PATCH_READY') {
      throw new Error(`Cannot approve run with status: ${existing.status}. Run must be awaiting approval.`);
    }

    const updatedPatch: CodePatch | undefined = existing.patch
      ? { ...existing.patch, approvalStatus: 'approved' }
      : undefined;

    return this.updateRun(id, {
      status: 'APPROVED',
      patch: updatedPatch
    });
  }

  public rejectRun(id: string): ServerRun {
    const existing = this.runs.get(id);
    if (!existing) {
      throw new Error(`Run not found: ${id}`);
    }

    if (existing.status !== 'AWAITING_APPROVAL' && existing.status !== 'PATCH_READY') {
      throw new Error(`Cannot reject run with status: ${existing.status}. Run must be awaiting approval.`);
    }

    const updatedPatch: CodePatch | undefined = existing.patch
      ? { ...existing.patch, approvalStatus: 'rejected' }
      : undefined;

    return this.updateRun(id, {
      status: 'REJECTED',
      patch: updatedPatch
    });
  }
}

export const runService = new RunService();
