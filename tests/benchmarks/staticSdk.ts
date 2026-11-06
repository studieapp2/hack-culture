import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const sdkRoot = realpathSync(join(dirname(require.resolve('@google/genai')), '../..'));
const compilerRoot = dirname(require.resolve('typescript/package.json'));
export const sdkVersion: string = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8')).version;
export const compilerVersion: string = JSON.parse(readFileSync(join(compilerRoot, 'package.json'), 'utf8')).version;
export const sdkDeclarationHash = createHash('sha256')
  .update(readFileSync(join(sdkRoot, 'dist/genai.d.ts'))).digest('hex');
export const STATIC_CRITERION = 'Static SDK typecheck only; no runtime correctness or provider measurement';
const prefix = "import type { GenerateContentParameters } from '@google/genai';\nconst request: GenerateContentParameters = ";
const suffix = ';\n';

/** Only this fixed type-only import and a JSON initializer can reach the compiler. */
export function requestSnippet(request: unknown): string {
  return `${prefix}${JSON.stringify(request)}${suffix}`;
}

function isJsonRequest(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A proposal must preserve the fixed import/declaration and JSON-only shape.
 * JSON parsing, rather than executing or transpiling input, excludes directives,
 * type assertions, functions, imports, plugins and arbitrary file references.
 */
export function parseProposal(code: string): Record<string, unknown> {
  if (Buffer.byteLength(code) > 16000 || !code.startsWith(prefix) || !code.endsWith(suffix))
    throw new Error('Proposal rejected: expected the fixed SDK import and JSON-only request declaration.');
  let request: unknown;
  try { request = JSON.parse(code.slice(prefix.length, -suffix.length)); }
  catch { throw new Error('Proposal rejected: request initializer must be plain JSON.'); }
  if (!isJsonRequest(request)) throw new Error('Proposal rejected: request must be a JSON object.');
  return request;
}

export function staticTypecheck(request: unknown): { passed: boolean; diagnostics: string } {
  // Re-serialize all input; the compiler never receives raw proposal text.
  const source = requestSnippet(request);
  const directory = mkdtempSync(join(tmpdir(), 'patchpilot-sdk-benchmark-'));
  try {
    mkdirSync(join(directory, 'node_modules/@google'), { recursive: true });
    mkdirSync(join(directory, 'empty-types'));
    symlinkSync(sdkRoot, join(directory, 'node_modules/@google/genai'), 'dir');
    writeFileSync(join(directory, 'case.ts'), source, { flag: 'wx', mode: 0o600 });
    const result = spawnSync(process.execPath, [
      join(compilerRoot, 'bin/tsc'), '--ignoreConfig', '--noEmit', '--strict',
      '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext',
      '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM',
      '--typeRoots', join(directory, 'empty-types'), '--pretty', 'false', 'case.ts',
    ], {
      cwd: directory, encoding: 'utf8', timeout: 15000, maxBuffer: 64000,
      // Never forward NODE_OPTIONS/NODE_PATH or provider credentials to a compiler.
      env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' },
    });
    if (result.error || result.signal || ![0, 1, 2].includes(result.status ?? -1))
      throw new Error('Installed TypeScript compiler could not complete the bounded static check.');
    const diagnostics = result.stdout.trim();
    if (result.status !== 0 && !/case\.ts\(\d+,\d+\): error TS\d+:/.test(diagnostics))
      throw new Error('Compiler failure did not contain a case-specific TypeScript diagnostic.');
    return { passed: result.status === 0, diagnostics };
  } finally {
    // Exact, fresh temporary directory owned by this invocation only.
    rmSync(directory, { recursive: true, force: true });
  }
}

const model = 'gemini-2.0-flash';
const contents = 'Reply with a short greeting.';
const request = (config: Record<string, unknown> = {}) => ({ model, contents, config });
export const sdkCases = [
  { id: 'temperature-placement', title: 'Move temperature into config',
    input: { model, contents, temperature: 0.2 }, corrected: request({ temperature: 0.2 }) },
  { id: 'output-limit-placement', title: 'Move maxOutputTokens into config',
    input: { model, contents, maxOutputTokens: 64 }, corrected: request({ maxOutputTokens: 64 }) },
  { id: 'system-instruction-placement', title: 'Move systemInstruction into config',
    input: { model, contents, systemInstruction: 'Be concise.' }, corrected: request({ systemInstruction: 'Be concise.' }) },
  { id: 'openai-max-tokens', title: 'Replace config.max_tokens with maxOutputTokens',
    input: request({ max_tokens: 64 }), corrected: request({ maxOutputTokens: 64 }) },
  { id: 'openai-response-format', title: 'Replace response_format with responseMimeType',
    input: request({ response_format: { type: 'json_object' } }), corrected: request({ responseMimeType: 'application/json' }) },
  { id: 'contents-type', title: 'Restore string contents rather than numeric contents',
    input: { model, contents: 42 }, corrected: request() },
  { id: 'model-type', title: 'Restore a string model identifier',
    input: { model: 42, contents }, corrected: request() },
  { id: 'temperature-type', title: 'Use a numeric temperature',
    input: request({ temperature: '0.2' }), corrected: request({ temperature: 0.2 }) },
] as const;

export function assessProposal(code: string) {
  try {
    const value = parseProposal(code);
    // Require the task's fixed nonempty request, preventing empty/no-op proposals.
    if (value.model !== model || value.contents !== contents)
      return { passed: false, diagnostics: 'Proposal rejected: preserve the controlled model and contents.' };
    return staticTypecheck(value);
  } catch {
    return { passed: false, diagnostics: 'Proposal rejected by the JSON-only static-check boundary.' };
  }
}
