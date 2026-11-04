# PatchPilot backend contract v1

Shared base: `a74ec2df3587e5c4f4c2dd21f1f10e04647a111d`.
The backend workstream is `feat/engine-live-diagnosis`. The existing dashboard
and REST interfaces remain unchanged.

Nick's MCP adapter should import:

```ts
import { diagnoseApiError } from './src/server/services/diagnoseApiError';
import type {
  DiagnoseApiErrorInput, DiagnoseApiErrorResult
} from './src/server/diagnoseApiError.contract';
```

`diagnoseApiError(input): Promise<DiagnoseApiErrorResult>` is the only new public
engine entry point. Input requires non-empty `error` and `code` strings, with
optional `fileName` (project-relative) and `language`. The engine neither reads
that path nor executes or modifies the supplied code.

Results have `contractVersion: "1"` and one of:

- `supported`: real provider calls, retrieved/extracted documentation, and
  validated source references support the diagnosis. An optional pending patch
  is a recommendation, not proof of a tested fix.
- `insufficient_evidence`: a diagnosis may exist, but it is unverified. No patch
  is presented as evidence-backed.
- `error`: explicit input, configuration, provider, response, timeout or budget
  errors. Errors are structured and contain no credential values.

`claims` retains verification statuses and source links. `sources` contains only
Tavily-returned URLs. `tests` explicitly reports `not_run`. `safety` always
states that submitted code was not executed or modified.

Usage records distinguish actual request counts, reported tokens and web
credits from unreported billing. `actualCostUsd: null` means unknown, not free.
The legacy model object's `estimatedCost` is not an invoice and must not be
displayed as an actual charge.

Configuration requires `BIFROST_BASE_URL`, a genuinely configured
`BIFROST_MODEL`, `BIFROST_API_KEY` if gateway authentication is enabled, the
model provider's key inside Bifrost, and `TAVILY_API_KEY`. Never put real keys in
this file, MCP examples, source code, logs, or commits.

Frontend, MCP and dependency/lockfile changes are outside Developer 1's scope.
Both developers should branch from the shared contract commit before parallel
implementation. Do not automatically merge either branch or rewrite main.
