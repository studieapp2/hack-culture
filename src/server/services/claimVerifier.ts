import { ExtractedClaim, VerifiedSource, ClaimVerificationStatus } from '../types';
import { tavilyService } from './tavilyService';
import { bifrostService } from './bifrostService';
import { RunBudget } from './runBudget';
import { serverConfig } from '../config';

export class ClaimVerifier {
  /**
   * Builds a concise, focused search query from a technical claim
   */
  public buildQuery(claimText: string): string {
    return tavilyService.sanitizeQuery(claimText)
      .replace(/[^\w\s\.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150);
  }

  /**
   * Verifies an individual claim against current Tavily sources
   */
  public async verifyClaim(claim: ExtractedClaim, budget?: RunBudget): Promise<ExtractedClaim> {
    // 1. Build search query
    const query = this.buildQuery(claim.originalText);

    let sources: VerifiedSource[] = [];
    try {
      if (budget && budget.deadlineAt <= Date.now()) {
        return { ...claim, status: 'ERROR', sources: [],
          explanation: 'The run deadline was reached before documentation retrieval.' };
      }
      if (tavilyService.isConfigured()) {
        if (budget && budget.searchCount >= serverConfig.maxTavilySearchesPerRun) {
          return { ...claim, status: 'INSUFFICIENT_EVIDENCE', sources: [],
            explanation: 'The per-run search budget was reached. This claim was not checked.' };
        }
        if (budget) budget.searchCount++;
        sources = await tavilyService.searchSources(query, { maxResults: 3,
          timeoutMs: budget ? budget.deadlineAt - Date.now() : undefined });
      } else {
        return {
          ...claim,
          status: 'INSUFFICIENT_EVIDENCE',
          explanation:
            'Tavily integration is not configured on the server. Cannot retrieve live documentation to verify this claim.',
          sources: []
        };
      }
    } catch (err: any) {
      return {
        ...claim,
        status: 'ERROR',
        explanation: `Failed to retrieve evidence from Tavily: ${err.message}`,
        sources: []
      };
    }

    if (sources.length === 0) {
      return {
        ...claim,
        status: 'INSUFFICIENT_EVIDENCE',
        explanation: 'No relevant authoritative documentation was located for this specific assertion.',
        sources: []
      };
    }

    // 2. Evaluate evidence using Bifrost if configured
    if (bifrostService.isConfigured()) {
      try {
        const evaluation = await this.evaluateWithModel(claim.originalText, sources, budget);
        return {
          ...claim,
          status: evaluation.status,
          explanation: evaluation.explanation,
          suggestedCorrection: evaluation.suggestedCorrection,
          sources
        };
      } catch (err: any) {
        console.warn('Model evidence evaluation failed, performing rule-based assessment:', err.message);
      }
    }

    // 3. Rule-based assessment of sources if model is unavailable
    return this.evaluateRuleBased(claim, sources);
  }

  private async evaluateWithModel(
    claimText: string,
    sources: VerifiedSource[],
    budget?: RunBudget
  ): Promise<{
    status: ClaimVerificationStatus;
    explanation: string;
    suggestedCorrection?: string;
  }> {
    const evidenceBlock = sources
      .map(
        (s, i) =>
          `[Source ${i + 1}] (${s.title} - ${s.publisher})\nURL: ${s.url}\nExcerpt: "${s.excerpt}"`
      )
      .join('\n\n');

    const prompt = `You are a strict, objective technical verification engine.
Evaluate whether the following CLAIM is accurate, outdated, or lacks sufficient proof based ONLY on the provided EVIDENCE.

CLAIM:
"${claimText}"

EVIDENCE:
${evidenceBlock}

RULES:
1. Status must be one of: "VERIFIED", "OUTDATED", "INSUFFICIENT_EVIDENCE", "UNCHECKABLE".
2. "OUTDATED" MUST have clear, explicit evidence showing that the claim has been deprecated, replaced, or is no longer true in current software releases. A missing source is NOT evidence that a claim is outdated.
3. "VERIFIED" requires explicit supporting evidence in the sources.
4. If sources are ambiguous or don't directly prove/disprove the claim, you MUST use "INSUFFICIENT_EVIDENCE".
5. If OUTDATED, provide a precise "suggested_correction".

Return valid JSON in this exact structure:
{
  "status": "VERIFIED" | "OUTDATED" | "INSUFFICIENT_EVIDENCE",
  "explanation": "Clear, objective explanation referencing evidence",
  "suggested_correction": "Optional corrected technical statement"
}`;

    const completion = await bifrostService.generateCompletion(
      [
        { role: 'system', content: 'You evaluate factual claims against evidence strictly and truthfully.' },
        { role: 'user', content: prompt }
      ],
      {
        responseFormat: 'json_object',
        temperature: 0.0,
        maxTokens: 800,
        runBudget: budget
      }
    );

    const json = completion.rawJson;
    const rawStatus = typeof json?.status === 'string' ? json.status.toUpperCase() : '';

    let status: ClaimVerificationStatus = 'INSUFFICIENT_EVIDENCE';
    if (['VERIFIED', 'OUTDATED', 'INSUFFICIENT_EVIDENCE', 'UNCHECKABLE'].includes(rawStatus)) {
      status = rawStatus as ClaimVerificationStatus;
    }

    return {
      status,
      explanation: typeof json?.explanation === 'string' ? json.explanation : 'No valid evidence explanation was returned.',
      suggestedCorrection: typeof json?.suggested_correction === 'string' ? json.suggested_correction : undefined
    };
  }

  private evaluateRuleBased(
    claim: ExtractedClaim,
    sources: VerifiedSource[]
  ): ExtractedClaim {
    return {
      ...claim,
      status: 'INSUFFICIENT_EVIDENCE',
      explanation: 'Sources were retrieved, but an automated LLM evaluation is required to reliably verify factual nuance.',
      sources
    };
  }
}

export const claimVerifier = new ClaimVerifier();
