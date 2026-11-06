import { pathToFileURL } from 'node:url';
import { buildPlan, liveBlockers, parseArguments } from './benchmark';

export function main(args = process.argv.slice(2)): number {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: tsx tests/benchmarks/cli.ts [--plan] [--model provider/model] [--max-tokens 15000] [--max-calls 4]\n       --live --budget-usd 0.01 (ceiling 1.93; currently refused without verifiable routing/charge bounds)\nstdout: importable v1 JSON report. stderr: local plan diagnostics/summary. Default: zero paid calls.\n');
    return 0;
  }
  try {
    const options = parseArguments(args);
    if (options.model && [process.env.BIFROST_API_KEY, process.env.TAVILY_API_KEY]
      .some(secret => secret && options.model!.includes(secret)))
      throw new Error('A model identifier must not contain provider credentials.');
    const blockers = liveBlockers(options, process.env);
    const plan = buildPlan(options);
    process.stdout.write(`${JSON.stringify(plan.report, null, 2)}\n`);
    process.stderr.write(`${JSON.stringify({
      mode: options.live ? 'live-refused' : 'plan', criterion: plan.criterion,
      sdkVersion: plan.sdkVersion, compilerVersion: plan.compilerVersion,
      sdkDeclarationHash: plan.sdkDeclarationHash, budgetUsd: options.budgetUsd,
      reservedUsd: 0, providerRequestsDispatched: 0, blockers, cases: plan.cases,
    }, null, 2)}\n`);
    return blockers.length ? 2 : 0;
  } catch {
    // Never echo arbitrary exception text, environment values or provider bodies.
    process.stderr.write('Benchmark aborted: invalid arguments or local SDK/compiler preflight failed. Run --help and the targeted tests. No provider dispatch occurred.\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main();
