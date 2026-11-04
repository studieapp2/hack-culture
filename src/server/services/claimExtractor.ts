import { ExtractedClaim } from '../types';
import { bifrostService } from './bifrostService';

export class ClaimExtractor {
  /**
   * Evaluates whether a factual claim is sensitive to freshness/versions/temporal drift
   */
  public isFreshnessSensitive(text: string): boolean {
    const freshnessKeywords = [
      /\bdeprecated\b/i,
      /\bsupported\b/i,
      /\bunsupported\b/i,
      /\bversion\b/i,
      /\bv\d+(\.\d+)?/i,
      /\bparameter\b/i,
      /\bargument\b/i,
      /\bendpoint\b/i,
      /\bapi\b/i,
      /\bsdk\b/i,
      /\blatest\b/i,
      /\bcurrent\b/i,
      /\brequires?\b/i,
      /\bguarantee\b/i,
      /\bsla\b/i,
      /\bmethod\b/i,
      /\blibrary\b/i
    ];
    return freshnessKeywords.some((pattern) => pattern.test(text));
  }

  /**
   * Extracts factual claims from the text, guaranteeing that every claim
   * references an exact substring with accurate start and end offsets.
   */
  public async extractClaims(text: string): Promise<ExtractedClaim[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Input text cannot be empty.');
    }

    // If Bifrost is configured, ask it to extract factual assertions from the text
    if (bifrostService.isConfigured()) {
      try {
        const claims = await this.extractWithModel(trimmed);
        if (claims.length > 0) {
          return claims;
        }
      } catch (err: any) {
        console.warn('Model-based claim extraction failed, falling back to deterministic extraction:', err.message);
      }
    }

    // Deterministic fallback: extract sentences that contain factual/technical assertions
    return this.extractDeterministically(trimmed);
  }

  private async extractWithModel(text: string): Promise<ExtractedClaim[]> {
    const systemPrompt = `You are an expert factual claim extraction engine for software documentation and technical advice.
Your task: Extract distinct, verifiable factual technical claims from the user's text.
CRITICAL RULES:
1. Every claim's "exact_quote" MUST be an EXACT, verbatim substring from the input text. Do NOT rephrase or invent words.
2. Only extract checkable assertions (e.g. API parameter names, versions, compatibility, performance guarantees).
3. Do not extract greetings, rhetorical questions, or subjective opinions.
4. Return valid JSON matching:
{
  "claims": [
    {
      "exact_quote": "exact substring from text",
      "topic": "API Parameters / Authentication / etc.",
      "freshness_sensitive": true
    }
  ]
}`;

    const result = await bifrostService.generateCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      {
        responseFormat: 'json_object',
        temperature: 0.0,
        maxTokens: 1000
      }
    );

    const parsed = result.rawJson;
    const rawList = Array.isArray(parsed?.claims) ? parsed.claims : [];
    const validated: ExtractedClaim[] = [];

    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      const quote = (item.exact_quote || '').trim();
      if (!quote || quote.length < 8) continue;

      const startOffset = text.indexOf(quote);
      if (startOffset === -1) {
        // Hallucinated quote or rephrasing: search for closest clean sentence match
        continue;
      }

      const endOffset = startOffset + quote.length;
      const freshnessSensitive = Boolean(
        item.freshness_sensitive ?? this.isFreshnessSensitive(quote)
      );

      validated.push({
        id: `claim-${Date.now()}-${i + 1}`,
        originalText: quote,
        startOffset,
        endOffset,
        topic: item.topic || 'Technical Assertion',
        freshnessSensitive,
        status: 'INSUFFICIENT_EVIDENCE',
        explanation: 'Pending verification against current documentation.',
        sources: []
      });
    }

    return validated;
  }

  /**
   * Deterministic sentence extraction with exact character offsets
   */
  public extractDeterministically(text: string): ExtractedClaim[] {
    // Split on sentence boundaries preserving locations
    const sentenceRegex = /[^.!?\n]+[.!?\n]+/g;
    let match: RegExpExecArray | null;
    const claims: ExtractedClaim[] = [];
    let claimIdx = 1;

    while ((match = sentenceRegex.exec(text)) !== null) {
      const sentence = match[0].trim();
      if (sentence.length < 15) continue;

      // Filter out subjective statements or generic conversational filler
      if (
        /^(hello|hi|please note|thank you|in summary|let me know|here is)/i.test(sentence) &&
        !this.isFreshnessSensitive(sentence)
      ) {
        continue;
      }

      const startOffset = match.index + match[0].indexOf(sentence);
      const endOffset = startOffset + sentence.length;
      const freshness = this.isFreshnessSensitive(sentence);

      claims.push({
        id: `claim-det-${Date.now()}-${claimIdx++}`,
        originalText: sentence,
        startOffset,
        endOffset,
        topic: freshness ? 'Version & API Specification' : 'Technical Assertion',
        freshnessSensitive: freshness,
        status: 'INSUFFICIENT_EVIDENCE',
        explanation: 'Extracted from source passage. Awaiting current evidence.',
        sources: []
      });

      if (claims.length >= 5) break; // Limit to 5 most prominent claims
    }

    return claims;
  }
}

export const claimExtractor = new ClaimExtractor();
