import { CodePatch, ExtractedClaim, MeasuredTokenUsage, RunTestResult } from '../types';
import { bifrostService } from './bifrostService';
import { claimExtractor } from './claimExtractor';
import { claimVerifier } from './claimVerifier';

export interface FixCodeInput {
  error: string;
  code?: string;
  fileName?: string;
  language?: string;
}

export interface FixCodeResult {
  diagnosis: string;
  claims: ExtractedClaim[];
  patch?: CodePatch;
  tests: RunTestResult[];
  usage: MeasuredTokenUsage;
}

export class FixCodeService {
  /**
   * Generates a unified diff format between original and proposed code
   */
  public generateUnifiedDiff(filePath: string, original: string, proposed: string): string {
    const origLines = original.split('\n');
    const propLines = proposed.split('\n');

    let diff = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${origLines.length} +1,${propLines.length} @@\n`;

    for (const line of origLines) {
      if (!propLines.includes(line)) {
        diff += `-${line}\n`;
      }
    }
    for (const line of propLines) {
      if (!origLines.includes(line)) {
        diff += `+${line}\n`;
      }
    }

    return diff;
  }

  public async analyzeAndFix(input: FixCodeInput): Promise<FixCodeResult> {
    const errorTrimmed = (input.error || '').trim();
    if (!errorTrimmed) {
      throw new Error('Error message or stack trace cannot be empty.');
    }

    const fileName = input.fileName || 'source_file.ts';
    const code = (input.code || '').trim();

    // Default test reporting: explicitly state that tests were not executed
    const tests: RunTestResult[] = [
      {
        id: 'test-sandbox-env',
        name: 'Automated Test Sandbox',
        status: 'not_run',
        output: 'Container sandbox worker not provisioned.',
        reason: 'Execution of untrusted code requires an isolated container worker. No tests were executed in this environment.'
      }
    ];

    if (!bifrostService.isConfigured()) {
      throw new Error(
        'BIFROST_BASE_URL is not configured on the server. AI diagnosis and patch generation require an active Bifrost gateway.'
      );
    }

    // Token-efficient targeted prompt
    const systemPrompt = `You are PatchPilot's token-efficient coding diagnostic agent.
Analyze the provided error and source code to identify the root cause and propose a minimal, reviewable code fix.

RULES:
1. ONLY produce a patch for lines that actually exist in the supplied code. Do not hallucinate or rewrite entire files.
2. If the error mentions API parameters, check whether the parameter name is deprecated or unsupported.
3. Keep tokens minimal.
4. Return valid JSON matching:
{
  "diagnosis": "Concise 1-2 sentence explanation of the root cause.",
  "technical_claims": [
    "Atomic factual claim about parameter compatibility or API behavior"
  ],
  "proposed_code": "The full updated code snippet reflecting the fix",
  "explanation": "Why this specific change resolves the error"
}`;

    const userPrompt = `ERROR:
${errorTrimmed}

${code ? `CODE (${fileName}):\n${code}` : 'No code snippet provided. Propose fix based on error.'}`;

    const completion = await bifrostService.generateCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      {
        responseFormat: 'json_object',
        temperature: 0.1,
        maxTokens: 1200
      }
    );

    const json = completion.rawJson;
    const diagnosis = json?.diagnosis || 'Identified potential error signature in provided context.';
    const rawClaims: string[] = Array.isArray(json?.technical_claims) ? json.technical_claims : [];
    const proposedCode = json?.proposed_code || code;
    const explanation = json?.explanation || 'Targeted correction for the identified defect.';

    // Verify technical claims if any are present
    const verifiedClaims: ExtractedClaim[] = [];
    for (const claimText of rawClaims.slice(0, 2)) {
      const claimObj: ExtractedClaim = {
        id: `claim-cf-${Date.now()}-${verifiedClaims.length}`,
        originalText: claimText,
        startOffset: 0,
        endOffset: claimText.length,
        freshnessSensitive: claimExtractor.isFreshnessSensitive(claimText),
        status: 'INSUFFICIENT_EVIDENCE',
        explanation: 'Extracted during diagnostic analysis.',
        sources: []
      };

      try {
        const verified = await claimVerifier.verifyClaim(claimObj);
        verifiedClaims.push(verified);
      } catch (err: any) {
        verifiedClaims.push({
          ...claimObj,
          status: 'ERROR',
          explanation: `Verification failed: ${err.message}`
        });
      }
    }

    let patch: CodePatch | undefined = undefined;
    if (code && proposedCode && proposedCode !== code) {
      patch = {
        id: `patch-${Date.now()}`,
        filePath: fileName,
        originalCode: code,
        proposedCode,
        unifiedDiff: this.generateUnifiedDiff(fileName, code, proposedCode),
        explanation,
        approvalStatus: 'pending'
      };
    }

    return {
      diagnosis,
      claims: verifiedClaims,
      patch,
      tests,
      usage: completion.usage
    };
  }
}

export const fixCodeService = new FixCodeService();
