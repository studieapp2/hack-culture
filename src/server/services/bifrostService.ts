import { serverConfig, IntegrationHealth } from '../config';
import { MeasuredTokenUsage } from '../types';
import { RunBudget, recordUsage } from './runBudget';
import { ProviderError } from './providerError';

export interface BifrostMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BifrostCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object' | 'text';
  runBudget?: {
    totalTokensUsed: number;
    callCount: number;
    searchCount?: number;
    reservedModelCalls?: number;
    deadlineAt?: number;
    usage?: MeasuredTokenUsage;
    requireReportedUsage?: boolean;
  };
}

export interface BifrostCompletionResult {
  content: string;
  usage: MeasuredTokenUsage;
  rawJson?: any;
}

export interface BifrostUsageRaw {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export class BifrostService {
  private get baseUrl(): string | undefined {
    return serverConfig.bifrostBaseUrl;
  }

  private get apiKey(): string | undefined {
    return serverConfig.bifrostApiKey;
  }

  public isConfigured(): boolean {
    try {
      const url = new URL(this.baseUrl || '');
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
        !url.search && !url.hash;
    } catch {
      return false;
    }
  }

  public async checkHealth(): Promise<IntegrationHealth> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        status: 'missing_configuration',
        details: 'BIFROST_BASE_URL is not set in server environment.'
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const cleanBaseUrl = this.baseUrl!.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');

      // Attempt to inspect models endpoint on the Bifrost gateway
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const resp = await fetch(`${cleanBaseUrl}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (resp.status === 401 || resp.status === 403) {
        return {
          configured: true,
          status: 'provider_error',
          error: 'Bifrost gateway returned 401/403 Unauthorized. Check BIFROST_API_KEY.'
        };
      }

      if (!resp.ok) {
        return {
          configured: true,
          status: 'provider_error',
          error: `Bifrost gateway returned HTTP ${resp.status}`
        };
      }
      const data = await resp.json();
      if (!Array.isArray(data?.data) || data.data.length === 0) {
        return { configured: true, status: 'provider_error',
          error: 'Bifrost models endpoint did not return a valid model list.' };
      }
      return {
        configured: true,
        status: 'connected_and_verified',
        details: 'Bifrost models endpoint connected and authorized. Model generation must be tested separately.'
      };
    } catch (err: any) {
      return {
        configured: true,
        status: 'disconnected',
        error: err?.name === 'AbortError' ? 'Bifrost health check timed out.' : 'Could not reach a valid Bifrost gateway.'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Dispatches a completion request through Bifrost with token accounting and fallback
   */
  public async generateCompletion(
    messages: BifrostMessage[],
    options: BifrostCompletionOptions = {}
  ): Promise<BifrostCompletionResult> {
    // Budget enforcement checked first
    if (options.runBudget) {
      if (options.runBudget.callCount >= serverConfig.maxModelCallsPerRun - (options.runBudget.reservedModelCalls || 0)) {
        throw new Error(
          `Model call budget exceeded (${options.runBudget.callCount}/${serverConfig.maxModelCallsPerRun} calls). Aborting to prevent token overrun.`
        );
      }
      if (options.runBudget.totalTokensUsed >= serverConfig.maxTokensPerRun) {
        throw new Error(
          `Token budget exhausted (${options.runBudget.totalTokensUsed}/${serverConfig.maxTokensPerRun} tokens). Aborting run.`
        );
      }
    }

    if (!this.isConfigured()) {
      throw new Error(
        'BIFROST_BASE_URL is not configured on the server. AI coding analysis and verification require a running Bifrost gateway.'
      );
    }

    const primaryModel = options.model || serverConfig.bifrostModel;
    const startTime = Date.now();

    try {
      return await this.dispatchCall(messages, primaryModel, options, startTime, false);
    } catch (primaryErr: any) {
      // Strict diagnosis must not hide an unreported failed attempt behind an
      // unpriced fallback. Legacy web callers retain their configured fallback.
      if (options.runBudget?.requireReportedUsage) throw primaryErr;
      // If fallback model is configured and the error is recoverable (e.g. rate limit, 5xx, or model not found)
      if (
        serverConfig.bifrostFallbackModel &&
        serverConfig.bifrostFallbackModel !== primaryModel &&
        (primaryErr.status === 429 || primaryErr.status === 404 || primaryErr.status >= 500)
      ) {
        console.warn('Bifrost primary model request failed; attempting the configured fallback.');
        return await this.dispatchCall(
          messages,
          serverConfig.bifrostFallbackModel,
          options,
          startTime,
          true,
          primaryModel
        );
      }
      throw primaryErr;
    }
  }

  private async dispatchCall(
    messages: BifrostMessage[],
    model: string,
    options: BifrostCompletionOptions,
    startTime: number,
    isFallback: boolean,
    previousModel?: string
  ): Promise<BifrostCompletionResult> {
    const budget = options.runBudget;
    const requestTimeout = Math.min(serverConfig.requestTimeoutMs,
      budget?.deadlineAt === undefined ? serverConfig.requestTimeoutMs : budget.deadlineAt - Date.now());
    if (requestTimeout <= 0) throw new ProviderError('bifrost', 'TIMEOUT', 'The run deadline was reached. No further model request was sent.');
    if (budget && budget.callCount >= serverConfig.maxModelCallsPerRun - (budget.reservedModelCalls || 0)) {
      throw new ProviderError('bifrost', 'BUDGET_EXCEEDED', 'Model call budget exceeded. No additional model request was sent.');
    }
    const remainingTokens = serverConfig.maxTokensPerRun - (budget?.totalTokensUsed || 0);
    if (remainingTokens <= 0) throw new ProviderError('bifrost', 'BUDGET_EXCEEDED', 'Token budget exhausted. No additional model request was sent.');
    if (budget?.usage && budget.usage.estimatedCost >= serverConfig.maxCostPerRunUsd) {
      throw new Error('Estimated cost budget exhausted. Actual billing depends on gateway pricing.');
    }
    // Conservative local upper bound; gateway-added prompt tokens are reported later.
    const promptBound = messages.reduce((sum, message) =>
      sum + Buffer.byteLength(message.content, 'utf8') + 256, 256);
    const outputLimit = Math.min(options.maxTokens ?? 1500, remainingTokens - promptBound);
    if (outputLimit <= 0) {
      throw new ProviderError('bifrost', 'BUDGET_EXCEEDED',
        'The input exceeds the remaining token budget. Reduce the code/evidence snippet.');
    }
    const configuredRates = model === serverConfig.bifrostModel &&
      serverConfig.bifrostInputUsdPerMillion !== undefined && serverConfig.bifrostOutputUsdPerMillion !== undefined;
    const inputRate = configuredRates ? serverConfig.bifrostInputUsdPerMillion! : 0.15;
    const outputRate = configuredRates ? serverConfig.bifrostOutputUsdPerMillion! : 0.60;
    if (budget?.usage && configuredRates) {
      const maximumEstimatedCost = (promptBound * inputRate + outputLimit * outputRate) / 1000000;
      if (budget.usage.estimatedCost + maximumEstimatedCost > serverConfig.maxCostPerRunUsd) {
        throw new ProviderError('bifrost', 'BUDGET_EXCEEDED',
          'The next request would exceed the configured estimated-cost limit. No model request was sent.');
      }
    }
    const cleanBaseUrl = this.baseUrl!.replace(/\/+$/, '');
    const endpoint = cleanBaseUrl.endsWith('/chat/completions')
      ? cleanBaseUrl
      : `${cleanBaseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const bodyPayload: any = {
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: outputLimit
    };

    if (options.responseFormat === 'json_object') {
      bodyPayload.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeout);

    try {
    if (budget) budget.callCount++;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal: controller.signal
    });

    if (!resp.ok) {
      await resp.body?.cancel();
      throw new ProviderError('bifrost', 'PROVIDER_ERROR',
        `Bifrost model request failed with status ${resp.status}. Check gateway credentials, model configuration and quota.`,
        resp.status);
    }

    let data: any;
    try { data = await resp.json(); } catch {
      if (controller.signal.aborted) throw new ProviderError('bifrost', 'TIMEOUT', 'Bifrost response timed out (request aborted).');
      throw new ProviderError('bifrost', 'INVALID_PROVIDER_RESPONSE', 'Bifrost returned an unreadable JSON response.', undefined, false);
    }
    const latencyMs = Date.now() - startTime;

    const content = data?.choices?.[0]?.message?.content;
    const rawUsage: BifrostUsageRaw = data?.usage || {};

    const validCount = (value: unknown): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    const promptTokens = validCount(rawUsage.prompt_tokens) ? rawUsage.prompt_tokens : 0;
    const completionTokens = validCount(rawUsage.completion_tokens) ? rawUsage.completion_tokens : 0;
    const totalTokens = Math.max(validCount(rawUsage.total_tokens) ? rawUsage.total_tokens : 0,
      promptTokens + completionTokens);

    // Retain the legacy UI estimate, but explicitly distinguish it from known pricing.
    const estimatedCost = (promptTokens * inputRate + completionTokens * outputRate) / 1000000;

    const usage: MeasuredTokenUsage = {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
      estimatedCost: Number(estimatedCost.toFixed(6)),
      currency: 'USD',
      isMeasured: validCount(rawUsage.prompt_tokens) && validCount(rawUsage.completion_tokens),
      model: typeof data?.model === 'string' ? data.model : model,
      requestedModel: model,
      provider: 'bifrost-gateway',
      usageReported: validCount(rawUsage.prompt_tokens) || validCount(rawUsage.completion_tokens) || validCount(rawUsage.total_tokens),
      costBasis: configuredRates ? 'configured_rates' : 'generic_estimate',
      latencyMs,
      fallbackUsed: isFallback,
      fallbackModel: isFallback ? model : undefined
    };
    if (budget?.usage) recordUsage(budget as RunBudget, usage);
    if (budget?.requireReportedUsage && !usage.isMeasured) {
      throw new ProviderError('bifrost', 'BUDGET_EXCEEDED',
        'The gateway did not report complete token usage. Further requests were stopped to keep the run budget bounded.');
    }
    if (typeof content !== 'string' || !content.trim() || data?.choices?.[0]?.finish_reason === 'length') {
      throw new ProviderError('bifrost', 'INVALID_PROVIDER_RESPONSE',
        'Bifrost returned empty or truncated completion content. No result was accepted.', undefined, false);
    }

    let rawJson: any = undefined;
    if (options.responseFormat === 'json_object') {
      try {
        rawJson = JSON.parse(content);
      } catch (parseErr) {
        // Try extracting JSON from markdown fences if model returned ```json ... ```
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            rawJson = JSON.parse(jsonMatch[1] || jsonMatch[0]);
          } catch {
            throw new ProviderError('bifrost', 'INVALID_PROVIDER_RESPONSE', 'Bifrost model response could not be parsed as valid JSON.', undefined, false);
          }
        } else {
          throw new ProviderError('bifrost', 'INVALID_PROVIDER_RESPONSE', 'Bifrost model failed to produce required JSON schema output.', undefined, false);
        }
      }
    }

    return {
      content,
      usage,
      rawJson
    };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (controller.signal.aborted) throw new ProviderError('bifrost', 'TIMEOUT', 'Bifrost request timed out (request aborted).');
      throw new ProviderError('bifrost', 'PROVIDER_ERROR', 'Could not reach the Bifrost model provider.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const bifrostService = new BifrostService();
