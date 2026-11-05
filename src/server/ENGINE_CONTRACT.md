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
Supported results require all checked version-sensitive claims to have valid
supporting references that are cited by the final diagnosis. A model's
unsupported positive verdict alone cannot satisfy this condition.

Usage records distinguish actual request counts, reported tokens and web
credits from unreported billing. `actualCostUsd: null` means unknown, not free.
The legacy model object's `estimatedCost` is not an invoice and must not be
displayed as an actual charge.
Strict runs stop further model work if complete token usage is missing, rather
than pretending an unknown token count is zero or allowing an unbounded run.
They also return primary provider failures explicitly rather than retrying an
unpriced application fallback. Legacy web callers retain their existing fallback
behavior. Gateway-internal retries/fees require provider-side budget controls.

Configuration requires `BIFROST_BASE_URL`, a genuinely configured
`BIFROST_MODEL`, `BIFROST_API_KEY` if gateway authentication is enabled, the
model provider's key inside Bifrost, and `TAVILY_API_KEY`. Never put real keys in
this file, MCP examples, source code, logs, or commits.

Frontend, MCP and dependency/lockfile changes are outside Developer 1's scope.
Both developers should branch from the shared contract commit before parallel
implementation. Do not automatically merge either branch or rewrite main.

## Validation

Run the existing suite with `bun run test`, and type checking with
`bun run lint`. Successful automated provider responses are fixtures, not live
provider evidence. The automated runners disable live credentials.

Run the controlled SDK probe and strict backend test from the repository root:

```sh
bun node_modules/tsx/dist/cli.mjs src/server/tests/liveDiagnosis.ts
```

The probe deliberately calls an unsupported method on the installed SDK and
captures the actual local error without making that SDK's API request. The
submitted example itself is not executed by the diagnosis engine. Missing
credentials produce the genuine structured configuration error. No fake
Bifrost/Tavily response is injected.

The live runner refuses paid calls until conservative model/credit price bounds
are configured, disables the application fallback, and reserves worst-case
estimated spending before each request against a fixed $2 ceiling. Prices must
cover the configured model, plan and gateway routing; verify provider-side spend
limits when routing adds retries or fees. Actual unreported invoices stay null.
Do not raise the ceiling without approval.

No new public HTTP route or code-execution facility is added. The existing
dashboard HTTP API has no authentication/ownership isolation and must not be
exposed as a multi-user public service without a verified access boundary.

Tavily can be validated independently when the Bifrost gateway is not reachable:

```sh
bun node_modules/tsx/dist/cli.mjs src/server/tests/liveTavilyValidation.ts
```

This runner uses the real securely supplied `TAVILY_API_KEY`, one basic search
and at most one basic extraction. It reserves $0.04 (at most two API credits)
against the live-test budget, records returned usage credits and URLs, and
does not make model calls or execute submitted code. Currency charges remain
unreported; the published pay-as-you-go estimate is not an invoice.

`http://localhost:8080/v1` refers to the machine running the engine. If Bifrost
is on a developer's computer instead, connect that computer or supply a securely
reachable gateway URL. Do not substitute an empty/demo gateway for a real model.
