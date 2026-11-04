import express, { Request, Response, NextFunction } from 'express';
import { serverConfig, HealthCheckResponse } from '../config';
import { tavilyService } from '../services/tavilyService';
import { bifrostService } from '../services/bifrostService';
import { claimExtractor } from '../services/claimExtractor';
import { claimVerifier } from '../services/claimVerifier';
import { fixCodeService } from '../services/fixCodeService';
import { runService } from '../services/runService';
import { createRunBudget } from '../services/runBudget';

export const apiRouter = express.Router();
// Hosting probes must not consume paid provider search/model quotas.
apiRouter.get('/ready', (_req, res) => {
  res.json({ status: 'ready' });
});
let activeWorkflows = 0;
const asyncRoute = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (activeWorkflows >= 2) {
      res.setHeader('Retry-After', '5');
      res.status(429).json({ error: 'Two runs are already in progress. Please retry shortly.' });
      return;
    }
    activeWorkflows++;
    handler(req, res).catch(next).finally(() => { activeWorkflows--; });
  };
let healthCheck: Promise<HealthCheckResponse> | undefined;
let healthExpiresAt = 0;

async function getIntegrationHealth(): Promise<HealthCheckResponse> {
  if (!healthCheck || Date.now() >= healthExpiresAt) {
    healthExpiresAt = Date.now() + 30000;
    healthCheck = (async () => {
      const [tavilyHealth, bifrostHealth] = await Promise.all([
        tavilyService.checkHealth(), bifrostService.checkHealth()
      ]);
      const status: HealthCheckResponse['status'] = !tavilyHealth.configured && !bifrostHealth.configured ? 'unconfigured' :
        tavilyHealth.status === 'connected_and_verified' && bifrostHealth.status === 'connected_and_verified'
          ? 'healthy' : 'degraded';
      return {
        status, timestamp: new Date().toISOString(), version: '1.0.0-prod',
        integrations: { tavily: tavilyHealth, bifrost: bifrostHealth },
        budgets: { maxTokensPerRun: serverConfig.maxTokensPerRun,
          maxCostPerRunUsd: serverConfig.maxCostPerRunUsd,
          maxModelCallsPerRun: serverConfig.maxModelCallsPerRun,
          maxSearchesPerRun: serverConfig.maxTavilySearchesPerRun }
      };
    })().catch((error) => { healthCheck = undefined; throw error; });
  }
  return healthCheck!;
}

/**
 * GET /api/health
 * Safe health check reporting integration connectivity without leaking secrets
 */
apiRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    res.json(await getIntegrationHealth());
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to perform health check', message: err.message });
  }
});

/**
 * POST /api/verify
 * Real Tavily-grounded stale-answer verification pipeline
 */
apiRouter.post('/verify', asyncRoute(async (req: Request, res: Response) => {
  const { text } = req.body || {};
  const trimmed = typeof text === 'string' ? text.trim() : '';

  if (!trimmed || trimmed.length > 20000) {
    res.status(400).json({ error: 'Input text must be a non-empty string of at most 20,000 characters.' });
    return;
  }

  // Create initial run record
  const run = runService.createRun('answer_verification', `Verify: ${trimmed.slice(0, 48)}...`, {
    answerInput: text,
    status: 'ANALYZING',
    steps: [
      { id: '1', label: 'Extract claims', status: 'active', timestamp: new Date().toISOString() },
      { id: '2', label: 'Assess freshness sensitivity', status: 'pending' },
      { id: '3', label: 'Retrieve authoritative evidence', status: 'pending' },
      { id: '4', label: 'Evaluate claims against evidence', status: 'pending' },
      { id: '5', label: 'Compile verification dossier', status: 'pending' }
    ]
  });

  const budget = createRunBudget();
  try {
    // 1. Extract claims
    const extracted = await claimExtractor.extractClaims(text, budget);
    if (extracted.length === 0) {
      throw new Error('No checkable claims were found. Please provide a technical assertion.');
    }

    runService.updateRun(run.id, {
      status: 'VERIFYING',
      claims: extracted,
      steps: [
        { id: '1', label: 'Extract claims', status: 'completed' },
        { id: '2', label: 'Assess freshness sensitivity', status: 'completed' },
        { id: '3', label: 'Retrieve authoritative evidence', status: 'active' },
        { id: '4', label: 'Evaluate claims against evidence', status: 'pending' },
        { id: '5', label: 'Compile verification dossier', status: 'pending' }
      ]
    });

    // 2. Verify claims against Tavily evidence
    const verifiedClaims = [];
    for (const claim of extracted) {
      const verified = await claimVerifier.verifyClaim(claim, budget);
      verifiedClaims.push(verified);
    }
    const hasEvidence = verifiedClaims.some((claim) => claim.sources.length > 0);
    const retrievalFailed = verifiedClaims.every((claim) => claim.status === 'ERROR');

    const finalRun = runService.updateRun(run.id, {
      status: retrievalFailed ? 'FAILED' : 'COMPLETED',
      errorMessage: retrievalFailed ? 'Documentation retrieval failed. Check Tavily credentials, connectivity, quota and the per-run timeout.' :
        !hasEvidence ? 'No evidence was retrieved. These claims have not been verified.' : undefined,
      claims: verifiedClaims,
      usage: budget.usage,
      steps: [
        { id: '1', label: 'Extract claims', status: 'completed' },
        { id: '2', label: 'Assess freshness sensitivity', status: 'completed' },
        { id: '3', label: 'Retrieve authoritative evidence', status: hasEvidence ? 'completed' : retrievalFailed ? 'failed' : 'skipped' },
        { id: '4', label: 'Evaluate claims against evidence', status: hasEvidence && bifrostService.isConfigured() ? 'completed' : 'skipped' },
        { id: '5', label: 'Compile verification dossier', status: 'completed' }
      ]
    });

    res.json(finalRun);
  } catch (err: any) {
    runService.updateRun(run.id, {
      status: 'FAILED',
      errorMessage: err.message,
      usage: budget.usage,
      steps: runService.getRun(run.id)!.steps.map((step) =>
        step.status === 'active' ? { ...step, status: 'failed' } : step)
    });
    res.status(500).json({ error: 'Verification failed', message: err.message, runId: run.id });
  }
}));

/**
 * POST /api/fix/analyze
 * Real Bifrost coding diagnosis and minimal patch pipeline
 */
apiRouter.post('/fix/analyze', asyncRoute(async (req: Request, res: Response) => {
  const { error, code, fileName, language } = req.body || {};
  const errorTrimmed = typeof error === 'string' ? error.trim() : '';

  if (!errorTrimmed || errorTrimmed.length > 20000 ||
    (code !== undefined && (typeof code !== 'string' || code.length > 100000)) ||
    (fileName !== undefined && (typeof fileName !== 'string' || fileName.length > 300 || /[\r\n]/.test(fileName))) ||
    (language !== undefined && (typeof language !== 'string' || language.length > 100))) {
    res.status(400).json({ error: 'Provide an error (max 20,000 characters), code (max 100,000 characters), and valid filename/language strings.' });
    return;
  }

  const title = fileName ? `Fix ${fileName}` : `Fix: ${errorTrimmed.slice(0, 40)}...`;
  const run = runService.createRun('code_fix', title, {
    errorInput: errorTrimmed,
    codeInput: code || '',
    fileName: fileName || 'source_file.ts',
    status: 'ANALYZING',
    steps: [
      { id: '1', label: 'Inspecting error', status: 'active' },
      { id: '2', label: 'Identifying relevant claims', status: 'pending' },
      { id: '3', label: 'Checking technical information', status: 'pending' },
      { id: '4', label: 'Preparing minimal patch', status: 'pending' },
      { id: '5', label: 'Reporting test execution availability', status: 'pending' },
      { id: '6', label: 'Ready for approval', status: 'pending' }
    ]
  });

  const budget = createRunBudget();
  try {
    const result = await fixCodeService.analyzeAndFix({
      error: errorTrimmed,
      code,
      fileName,
      language
    }, budget);

    const finalRun = runService.updateRun(run.id, {
      status: result.patch ? 'AWAITING_APPROVAL' : 'COMPLETED',
      diagnosis: result.diagnosis,
      claims: result.claims,
      patch: result.patch,
      tests: result.tests,
      usage: result.usage,
      steps: [
        { id: '1', label: 'Inspecting error', status: 'completed' },
        { id: '2', label: 'Identifying relevant claims', status: 'completed' },
        { id: '3', label: 'Checking technical information', status: 'completed' },
        { id: '4', label: 'Preparing minimal patch', status: 'completed' },
        { id: '5', label: 'Reporting test execution availability', status: 'completed',
          description: 'No isolated test worker is configured. Proposed-code tests were not executed.' },
        { id: '6', label: 'Ready for approval', status: 'completed' }
      ]
    });

    res.json(finalRun);
  } catch (err: any) {
    runService.updateRun(run.id, {
      status: 'FAILED',
      errorMessage: err.message,
      usage: budget.usage,
      steps: runService.getRun(run.id)!.steps.map((step) =>
        step.status === 'active' ? { ...step, status: 'failed' } : step)
    });
    res.status(500).json({ error: 'Analysis failed', message: err.message, runId: run.id });
  }
}));

/**
 * GET /api/runs
 */
apiRouter.get('/runs', (req: Request, res: Response) => {
  const { type, status, search } = req.query;
  if ([type, status, search].some((value) => value !== undefined && typeof value !== 'string')) {
    res.status(400).json({ error: 'Run filters must be strings.' });
    return;
  }
  const runs = runService.listRuns({
    type: type as any,
    status: status as any,
    search: search as string
  });
  res.json(runs);
});

/**
 * GET /api/runs/:id
 */
apiRouter.get('/runs/:id', (req: Request, res: Response) => {
  const run = runService.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(run);
});

/**
 * POST /api/runs/:id/approve
 */
apiRouter.post('/runs/:id/approve', (req: Request, res: Response) => {
  if (!runService.getRun(req.params.id)) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  try {
    const updated = runService.approveRun(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/runs/:id/reject
 */
apiRouter.post('/runs/:id/reject', (req: Request, res: Response) => {
  if (!runService.getRun(req.params.id)) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  try {
    const updated = runService.rejectRun(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
