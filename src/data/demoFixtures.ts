import { Run, AppSettings, Claim, Patch, TestResult, TokenUsage, WorkflowStep } from '../types/domain';

export const SAMPLE_ERROR_INPUT = `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.`;

export const SAMPLE_CODE_INPUT = `# demo_client.py
import os
from demo_ai import DemoClient

client = DemoClient(api_key=os.environ.get("DEMO_API_KEY"))

def generate_summary(prompt: str) -> str:
    messages = [{"role": "user", "content": prompt}]
    response = client.chat.completions.create(
        model="demo-model",
        messages=messages,
        max_tokens=500
    )
    return response.choices[0].message.content
`;

export const SAMPLE_ANSWER_INPUT = `To invoke the modern completions endpoint, initialize DemoClient with your api_key. When configuring the request, specify the model identifier and pass max_tokens to restrict response generation length. All production endpoints provide a guaranteed sub-150ms P99 latency SLA on the standard tier.`;

export const SAMPLE_CODE_FIX_CLAIMS: Claim[] = [
  {
    id: 'claim-cf-1',
    text: "The selected model 'demo-model' accepts 'max_tokens' for response length restriction.",
    status: 'outdated',
    explanation: "The supplied error indicates this parameter is unsupported for the selected demo model. The model specification requires 'max_completion_tokens'.",
    suggestedCorrection: "Replace 'max_tokens' with 'max_completion_tokens' when invoking this model.",
    freshnessSensitive: true,
    sources: [
      {
        id: 'src-cf-1',
        title: 'Demo Model API Reference — Completion Parameters',
        publisher: 'Demo AI Documentation (Sample)',
        publishedAt: '2026-03-15',
        retrievedAt: '2026-11-03',
        excerpt: "Parameter 'max_tokens' is deprecated for demo-model series. Use 'max_completion_tokens' to specify generation budget.",
        isDemoSource: true
      }
    ]
  }
];

export const SAMPLE_CODE_PATCH: Patch = {
  id: 'patch-demo-1',
  filePath: 'demo_client.py',
  originalCode: `    response = client.chat.completions.create(
        model="demo-model",
        messages=messages,
        max_tokens=500
    )`,
  proposedCode: `    response = client.chat.completions.create(
        model="demo-model",
        messages=messages,
        max_completion_tokens=500
    )`,
  explanation: "Replaced deprecated 'max_tokens' with 'max_completion_tokens' per demo-model specification.",
  approvalStatus: 'pending'
};

export const SAMPLE_TEST_RESULTS: TestResult[] = [
  {
    id: 'test-1',
    name: 'Python syntax & AST validation',
    status: 'passed',
    output: 'Valid Python 3.11 AST syntax. No parsing errors detected.',
    simulated: true,
    durationMs: 42
  },
  {
    id: 'test-2',
    name: 'Parameter signature verification',
    status: 'passed',
    output: 'Client.chat.completions.create accepts max_completion_tokens (int).',
    simulated: true,
    durationMs: 78
  }
];

export const SAMPLE_VERIFY_ANSWER_CLAIMS: Claim[] = [
  {
    id: 'claim-va-1',
    text: "To invoke the modern completions endpoint, initialize DemoClient with your api_key.",
    status: 'verified',
    explanation: "DemoClient constructor standardizes authentication through the 'api_key' keyword argument across all active client SDK versions.",
    sources: [
      {
        id: 'src-va-1',
        title: 'DemoClient SDK Setup & Authentication Guide',
        publisher: 'Developer Portal (Sample)',
        publishedAt: '2026-01-10',
        retrievedAt: '2026-11-03',
        excerpt: "Client instances authenticate using DemoClient(api_key=token). Environment variable DEMO_API_KEY is resolved automatically if omitted.",
        isDemoSource: true
      }
    ]
  },
  {
    id: 'claim-va-2',
    text: "Pass max_tokens to restrict response generation length.",
    status: 'outdated',
    explanation: "In current documentation for this demo model series, 'max_tokens' is superseded by 'max_completion_tokens'.",
    suggestedCorrection: "Use 'max_completion_tokens' instead of 'max_tokens' to limit response generation length.",
    freshnessSensitive: true,
    sources: [
      {
        id: 'src-va-2',
        title: 'API Migration Notice: Reasoning & Chat Parameter Standardization',
        publisher: 'Engineering Changelog (Sample)',
        publishedAt: '2026-04-02',
        retrievedAt: '2026-11-03',
        excerpt: "Breaking change: 'max_tokens' rejected for newer models. Callers must supply 'max_completion_tokens' to ensure predictable reasoning token allocation.",
        isDemoSource: true
      }
    ]
  },
  {
    id: 'claim-va-3',
    text: "All production endpoints provide a guaranteed sub-150ms P99 latency SLA on the standard tier.",
    status: 'uncertain',
    explanation: "Standard public documentation does not publish a contractual sub-150ms P99 latency SLA for shared tiers. Latency benchmarks depend on request payload size and traffic.",
    sources: [
      {
        id: 'src-va-3',
        title: 'Service Level Terms & Performance Objectives',
        publisher: 'Platform Operations (Sample)',
        publishedAt: '2025-11-20',
        retrievedAt: '2026-11-03',
        excerpt: "P99 latency targets are operational guidelines rather than contractual guarantees for non-dedicated multi-tenant infrastructure.",
        isDemoSource: true
      }
    ]
  }
];

export const INITIAL_RUNS: Run[] = [
  {
    id: 'run-cf-101',
    title: "Fix unsupported 'max_tokens' parameter in demo_client.py",
    type: 'code_fix',
    status: 'awaiting_approval',
    createdAt: '2026-11-03T06:20:00Z',
    updatedAt: '2026-11-03T06:21:15Z',
    errorInput: SAMPLE_ERROR_INPUT,
    codeInput: SAMPLE_CODE_INPUT,
    diagnosis: "The request uses a parameter ('max_tokens') that the selected demo model does not accept. Compatibility depends on provider, model, and API version.",
    steps: [
      { id: 'step-1', label: 'Inspecting error', status: 'completed', description: 'Extracted parameter mismatch signature' },
      { id: 'step-2', label: 'Identifying relevant claims', status: 'completed', description: 'Extracted API contract claims' },
      { id: 'step-3', label: 'Checking technical information', status: 'completed', description: 'Flagged max_tokens as outdated for demo-model' },
      { id: 'step-4', label: 'Preparing minimal patch', status: 'completed', description: 'Prepared single-line parameter substitution' },
      { id: 'step-5', label: 'Reviewing simulated tests', status: 'completed', description: '2 simulated checks executed' },
      { id: 'step-6', label: 'Ready for approval', status: 'completed', description: 'Awaiting developer sign-off' }
    ],
    claims: SAMPLE_CODE_FIX_CLAIMS,
    patch: SAMPLE_CODE_PATCH,
    tests: SAMPLE_TEST_RESULTS,
    usage: {
      inputTokens: 412,
      outputTokens: 98,
      totalTokens: 510,
      estimatedCost: 0.0015,
      currency: 'USD',
      simulated: true
    }
  },
  {
    id: 'run-va-102',
    title: 'Verify completion client parameter guidelines',
    type: 'answer_verification',
    status: 'completed',
    createdAt: '2026-11-03T05:45:00Z',
    updatedAt: '2026-11-03T05:46:02Z',
    answerInput: SAMPLE_ANSWER_INPUT,
    steps: [
      { id: 'step-1', label: 'Extract claims', status: 'completed', description: 'Identified 3 factual claims' },
      { id: 'step-2', label: 'Assess freshness sensitivity', status: 'completed', description: '2 claims marked version-sensitive' },
      { id: 'step-3', label: 'Review sample evidence', status: 'completed', description: 'Matched against local demo fixtures' },
      { id: 'step-4', label: 'Classify claims', status: 'completed', description: '1 Verified, 1 Outdated, 1 Uncertain' },
      { id: 'step-5', label: 'Produce report', status: 'completed', description: 'Generated claim-level evidence cards' }
    ],
    claims: SAMPLE_VERIFY_ANSWER_CLAIMS,
    tests: [],
    usage: {
      inputTokens: 320,
      outputTokens: 145,
      totalTokens: 465,
      estimatedCost: 0.0014,
      currency: 'USD',
      simulated: true
    }
  },
  {
    id: 'run-cf-100',
    title: 'Resolve missing timeout handler in webhook_receiver.ts',
    type: 'code_fix',
    status: 'approved',
    createdAt: '2026-11-02T19:12:00Z',
    updatedAt: '2026-11-02T19:14:30Z',
    errorInput: "TimeoutError: Request exceeded 30000ms threshold without server response in WebhookReceiver.handlePayload",
    diagnosis: "Inbound webhook processing lacked an explicit abort signal timeout wrapper.",
    steps: [
      { id: 'step-1', label: 'Inspecting error', status: 'completed' },
      { id: 'step-2', label: 'Identifying relevant claims', status: 'completed' },
      { id: 'step-3', label: 'Checking technical information', status: 'completed' },
      { id: 'step-4', label: 'Preparing minimal patch', status: 'completed' },
      { id: 'step-5', label: 'Reviewing simulated tests', status: 'completed' },
      { id: 'step-6', label: 'Ready for approval', status: 'completed' }
    ],
    claims: [
      {
        id: 'claim-cf-old',
        text: "AbortSignal.timeout(ms) is supported in current Node.js runtimes.",
        status: 'verified',
        explanation: "Supported natively since Node.js v17.3.0 and baseline in Node 18+.",
        sources: []
      }
    ],
    patch: {
      id: 'patch-old-1',
      filePath: 'src/webhook_receiver.ts',
      originalCode: 'const response = await fetch(endpoint, { method: "POST" });',
      proposedCode: 'const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(10000) });',
      explanation: 'Added 10s AbortSignal timeout to prevent hanging connections.',
      approvalStatus: 'approved'
    },
    tests: [
      { id: 't-1', name: 'TypeScript compile test', status: 'passed', output: 'TS clean compile.', simulated: true }
    ],
    usage: {
      inputTokens: 380,
      outputTokens: 85,
      totalTokens: 465,
      estimatedCost: 0.0013,
      currency: 'USD',
      simulated: true
    }
  }
];

export const DEFAULT_SETTINGS: AppSettings = {
  workspaceName: 'Acme Engineering',
  defaultLandingPage: 'overview',
  budgetMaxCost: 2.0,
  budgetMaxTokens: 50000,
  budgetWarningThreshold: 80,
  requireApprovalPatches: true,
  requireApprovalCommands: true,
  readOnlyAnalysisDefault: true
};
