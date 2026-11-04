import express, { Request, Response } from 'express';
import { serverConfig, HealthCheckResponse } from '../config';
import { tavilyService } from '../services/tavilyService';
import { bifrostService } from '../services/bifrostService';
import { claimExtractor } from '../services/claimExtractor';
import { claimVerifier } from '../services/claimVerifier';
import { fixCodeService } from '../services/fixCodeService';
import { runService } from '../services/runService';

export const apiRouter = express.Router();

/**
 * GET /api/health
 * Safe health check reporting integration connectivity without leaking secrets
 */
apiRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const [tavilyHealth, bifrostHealth] = await Promise.all([
      tavilyService.checkHealth(),
      bifrostService.checkHealth()
    ]);

    let overallStatus: 'healthy' | 'degraded' | 'unconfigured' = 'healthy';
    if (!tavilyHealth.configured && !bifrostHealth.configured) {
      overallStatus = 'unconfigured';
    } else if (
      tavilyHealth.status !== 'connected_and_verified' ||
      bifrostHealth.status !== 'connected_and_verified'
    ) {
      overallStatus = 'degraded';
    }

    const payload: HealthCheckResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0-prod',
      integrations: {
        tavily: tavilyHealth,
        bifrost: bifrostHealth
      },
      budgets: {
        maxTokensPerRun: serverConfig.maxTokensPerRun,
        maxCostPerRunUsd: serverConfig.maxCostPerRunUsd,
        maxModelCallsPerRun: serverConfig.maxModelCallsPerRun,
        maxSearchesPerRun: serverConfig.maxTavilySearchesPerRun
      }
    };

    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to perform health check', message: err.message });
  }
});

/**
 * POST /api/verify
 * Real Tavily-grounded stale-answer verification pipeline
 */
apiRouter.post('/verify', async (req: Request, res: Response) => {
  const { text } = req.body;
  const trimmed = (text || '').trim();

  if (!trimmed) {
    res.status(400).json({ error: 'Input text is required and cannot be empty.' });
    return;
  }

  // Create initial run record
  const run = runService.createRun('answer_verification', `Verify: ${trimmed.slice(0, 48)}...`, {
    answerInput: trimmed,
    status: 'ANALYZING',
    steps: [
      { id: '1', label: 'Extract claims', status: 'active', timestamp: new Date().toISOString() },
      { id: '2', label: 'Assess freshness sensitivity', status: 'pending' },
      { id: '3', label: 'Retrieve authoritative evidence', status: 'pending' },
      { id: '4', label: 'Evaluate claims against evidence', status: 'pending' },
      { id: '5', label: 'Compile verification dossier', status: 'pending' }
    ]
  });

  try {
    // 1. Extract claims
    const extracted = await claimExtractor.extractClaims(trimmed);

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
      const verified = await claimVerifier.verifyClaim(claim);
      verifiedClaims.push(verified);
    }

    const finalRun = runService.updateRun(run.id, {
      status: 'COMPLETED',
      claims: verifiedClaims,
      steps: [
        { id: '1', label: 'Extract claims', status: 'completed' },
        { id: '2', label: 'Assess freshness sensitivity', status: 'completed' },
        { id: '3', label: 'Retrieve authoritative evidence', status: 'completed' },
        { id: '4', label: 'Evaluate claims against evidence', status: 'completed' },
        { id: '5', label: 'Compile verification dossier', status: 'completed' }
      ]
    });

    res.json(finalRun);
  } catch (err: any) {
    runService.updateRun(run.id, {
      status: 'FAILED',
      errorMessage: err.message
    });
    res.status(500).json({ error: 'Verification failed', message: err.message, runId: run.id });
  }
});

/**
 * POST /api/fix/analyze
 * Real Bifrost coding diagnosis and minimal patch pipeline
 */
apiRouter.post('/fix/analyze', async (req: Request, res: Response) => {
  const { error, code, fileName, language } = req.body;
  const errorTrimmed = (error || '').trim();

  if (!errorTrimmed) {
    res.status(400).json({ error: 'Error message or stack trace is required.' });
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
      { id: '5', label: 'Reviewing simulated tests', status: 'pending' },
      { id: '6', label: 'Ready for approval', status: 'pending' }
    ]
  });

  try {
    const result = await fixCodeService.analyzeAndFix({
      error: errorTrimmed,
      code,
      fileName,
      language
    });

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
        { id: '5', label: 'Reviewing simulated tests', status: 'completed' },
        { id: '6', label: 'Ready for approval', status: 'completed' }
      ]
    });

    res.json(finalRun);
  } catch (err: any) {
    runService.updateRun(run.id, {
      status: 'FAILED',
      errorMessage: err.message
    });
    res.status(500).json({ error: 'Analysis failed', message: err.message, runId: run.id });
  }
});

/**
 * GET /api/runs
 */
apiRouter.get('/runs', (req: Request, res: Response) => {
  const { type, status, search } = req.query;
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
  try {
    const updated = runService.rejectRun(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
