# PatchPilot core development checklist

This is implementation status, not proof of live provider/editor success.
The Windows agent limitation does not block the code tasks below.

## Implemented and checked

- Local stdio MCP: diagnosis, verified patch proposal and technical-claim
  verification. All reuse existing backend paths; no user code is executed.
- Connect page: portable Cursor configuration, clipboard/error handling and
  backend readiness separated from unverified editor discovery.
- Usage/test/run presentation: unknowns remain unreported, unrun tests are
  retained, and pending requests do not invent backend activity.
- Browser input preflight and safe evidence links. These are not substitutes
  for backend validation.
- Benchmarks page: strict local report import and fair/null-aware comparisons.
  Imported results are explicitly not independently reverified.
- Real installed-SDK sample error, tested offline without network requests.
- Combined backend, MCP and client validation and reviewable draft PR #3.

## In progress

- Benchmark plan/static evaluator and trusted-callback execution orchestration.
  Live CLI dispatch remains unavailable without a real routing/spending verifier.
  A plan or local fixture must never be reported as measured model performance.

## Highest-priority backend-owner work

1. Enforce credential-bearing-input rejection on REST endpoints before history
   persistence and provider calls. Frontend/MCP guards can be bypassed by other
   API clients. Reuse the existing server-side sensitive-data validator.
2. Make private source-code retention opt-in; preserve useful run metadata
   without storing raw code by default. Do not delete existing history silently.
3. Align manual Fix Code with the strict evidence/safety/accounting guarantees
   used by MCP, preserving REST compatibility or explicitly versioning it.
4. Provide transparent nullable freshness scores with date/version/evidence
   basis. Tavily relevance scores are not freshness or correctness probabilities.
5. Before public or multi-user hosting, add authenticated ownership and per-user
   usage enforcement. Local stdio support is not remote-service production proof.
6. Supply a testable live-benchmark preflight capability for actual gateway
   version/configuration, allowed model/provider, retries/plugins/routing and
   conservative model plus Tavily charge bounds. Env assertions alone are not
   verification. No changes to protected backend contracts without coordination.

## Live acceptance still unverified

- Real model generation and full Bifrost/Tavily-backed SDK fix.
- Cursor invocation; Codex/Claude Code invocation where available.
- Real baseline-versus-PatchPilot benchmark measurements on identical tasks,
  including failures.
- User Windows/WSL runtime operations requiring the blocked machine agent.

Do not repeat installation/support requests during development. Preserve the
existing Bifrost installation and credentials, spending limits and no-purchase
rule. Never merge or force-push automatically.
