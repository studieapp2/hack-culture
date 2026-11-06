# Local SDK benchmark plan

Run without installing anything:

```sh
npx --no-install tsx tests/benchmarks/cli.ts
npx --no-install tsx --test tests/benchmarks/benchmark.test.ts
```

Stdout is an importable strict v1 Benchmarks report. Stderr contains the plan,
actual installed SDK diagnostics, compiler/SDK versions, declaration hash and
refusal reasons. Redirect outputs to explicitly chosen files if desired. The
default is plan-only, budget $0, no provider requests, every method `not_run`,
all usage/cost fields null. Local diagnostic compilation is not a method run.

Eight controlled cases cover config placement, OpenAI-style parameter names,
and model/contents/temperature types for `@google/genai`. Every input must
actually fail against the installed SDK declarations; the plan aborts if that
changes. Corrected fixtures exist only for offline evaluator tests and are never
used as runtime model results.

The sole criterion is **static SDK typecheck**, not runtime correctness,
documentation correctness, semantic equivalence or measured API behavior.
Proposals must preserve the fixed type-only SDK import and JSON request
declaration. The checker re-serializes parsed JSON and invokes the installed
TypeScript compiler with fixed no-emit options in an owned temporary directory.
No generated code runs, no patch is applied, no tsconfig/plugins are generated
or read, and no compiler subprocess receives credentials or Node preload flags.
Compiler libraries and installed SDK declaration dependencies are the only
non-temporary inputs to the static check.

## Live mode is deliberately unavailable with current interfaces

`--live --budget-usd N --model provider/model` requires a positive explicit
budget at most **$1.93**. It writes an honest all-not-run report and exits **2**,
before dispatch. Exit **1** means invalid arguments or failed local preflight.
Exit **0** is a successful plan, never a successful live benchmark.

The existing Bifrost/diagnosis interfaces do not expose independently verifiable
exact gateway routing, hidden retry/input overhead bounds or maximum Tavily
search/extraction charges. Configured environment rates, `/models` and health
checks do not prove these. The CLI therefore cannot safely reserve a verified
worst-case amount and refuses rather than presenting estimates as hard ceilings.
No health checks, searches, extraction, or completions are sent by the CLI.

The guarded lazy `existingMethodAdapters` factory wires the simple baseline to
`bifrostService.generateCompletion` and PatchPilot to `diagnoseApiError`, with
the same controlled diagnostic/code input. It is **not a live dispatcher** and
does not certify model/budget equality or pricing. It refuses access under the
same preflight as the CLI, before loading any provider/configuration modules.
Baseline disables fallback
via strict usage accounting. PatchPilot chooses server-configured limits/model,
so a future live dispatcher must also verify their exact equality to requested
limits, reserve model/search/extraction worst-case costs before each dispatch,
retain spending on failed/incomplete requests and export their accounting
honestly. No such verification authority is inferred from environment flags.
Never call these adapters directly to bypass the CLI refusal.

`SpendReservation` provides a monotone, upward-rounded local reservation helper;
it is not claimed to constrain a remote provider. Its limits and the CLI's no-call
and routing/pricing refusal paths are covered by offline tests. No secret values
or raw provider response bodies are included in report or plan outputs.
