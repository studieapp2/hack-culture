# PatchPilot

React/Vite frontend and Express API, served together by `server.ts`.

## Local development

Use Bun 1.4.0 and Node 20.19+ or 22.12+ (Node 24 LTS recommended for new deployments).

```sh
bun install --frozen-lockfile
PORT=3100 bun run dev
```

Open `http://localhost:3100` on the computer running the server. A server in a
remote workspace is not reachable through your own computer's localhost.
Vite hot reload shares the Express port.

## Checks

```sh
bun run test
bun run lint
bun run build
```

The core integration branch also provides:

```sh
bun run test:all
bun run benchmark:plan
```

`test:all` builds the stdio server and runs backend, MCP, client and benchmark
checks. `benchmark:plan` emits eight **not-run** SDK cases with unknown
measurements; it does not call a provider or produce live benchmark results.
The static evaluator checks the installed SDK's TypeScript request types without
executing generated code. Live benchmarking remains blocked until a real
routing/spending verifier is available; `--live` must not be treated as working.

MCP exposes `diagnose_api_error`, `propose_verified_patch`, and
`verify_technical_claims`. Code tools reuse the strict engine. Claim verification
reuses the local backend API and stores its run in history. Start the backend
alongside the stdio server; see `src/mcp/README.md` for configuration and the
Connect page for a portable Cursor configuration. No actual Cursor or live model
success is implied by passing automated checks.

Regression tests use isolated temporary storage and explicitly mocked provider
responses. Passing them is not proof that live Tavily/Bifrost credentials work.

For manual browser testing of successful review flows without paid credentials,
build first, then run `bun run test:ui-server`. This
loopback-only test server uses isolated storage and labels its fake provider
responses as test fixtures; it must never be publicly exposed or deployed.

## Production hosting

Use an always-on Node web service with Bun available during dependency
installation. Keep the existing app and API together:

- Install: `bun install --frozen-lockfile`
- Build: `bun run build`
- Start: `NODE_ENV=production bun run start`
- Port: the host's `PORT` environment variable (default 3000), bound to `0.0.0.0`.
- Hosting health path: `/api/ready` (no paid provider probes).
- Integration status: `/api/health` (reports provider state separately).
- Attach persistent storage and set `PATCHPILOT_DATA_DIR` to its writable directory.
- Run one instance; the current JSON run store is not a multi-instance database.

A temporary Cloudflare quick tunnel is only a preview, not permanent hosting.
Hosting account access, plan approval, and real provider configuration are
required before a permanent URL can be verified.

## Integrations and honest limitations

Set configuration server-side using `.env.example` as a template. Never commit
the actual `.env` or put keys in frontend `VITE_*` variables.

- `TAVILY_API_KEY`: live documentation search/extraction at Tavily's `/search`
  and `/extract` endpoints.
- `BIFROST_BASE_URL`: reachable gateway API base, e.g. `https://your-gateway/v1`.
- `BIFROST_MODEL`: model actually configured in that gateway.
- `BIFROST_API_KEY`: needed if gateway authentication is enabled.
- `BIFROST_FALLBACK_MODEL`: optional; retries only recoverable HTTP failures and
  consumes the same run budget.

Without Tavily, claims remain insufficiently evidenced. Without Bifrost,
coding diagnosis fails explicitly; deterministic claim extraction is still
available but does not invent verification results. Model-list health is
connectivity verification, not proof a paid generation request will succeed.
Health checks are cached for 30 seconds to avoid repeated paid search probes.

For API-related fixes with Tavily configured, PatchPilot retrieves evidence and
reserves a model call to revise the final patch against that documentation.
If no evidence is found, it withholds the earlier model-only API patch. Without
Tavily, any model-only proposal is explicitly labeled unverified. Syntax-only
proposals remain available when no external API claims are identified.

Model call and search limits apply across the whole run. Token limits stop
further calls based on reported usage and cap requested output; prompt tokens
and missing provider usage prevent an absolute billing guarantee. Dollar costs
use a generic estimate, not model-specific pricing. Enforce actual spending
limits in the gateway/provider account.
Runs have a 90-second shared deadline; provider calls use the remaining time.
Browser requests also time out and direct users to check run history before
retrying, rather than leaving the interface stuck indefinitely.

Approving a patch records a review decision; it does not modify your GitHub
repository. Actual code execution and automatic GitHub PR submission are not
implemented. Proposed-code tests remain honestly marked `not_run` until an
isolated execution worker is provisioned.
