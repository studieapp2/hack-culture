import { serverConfig, IntegrationHealth } from '../config';
import { MeasuredTokenUsage } from '../types';
import { RunBudget, recordUsage } from './runBudget';

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
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
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

      clearTimeout(timeout);

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
      // If fallback model is configured and the error is recoverable (e.g. rate limit, 5xx, or model not found)
      if (
        serverConfig.bifrostFallbackModel &&
        serverConfig.bifrostFallbackModel !== primaryModel &&
        (primaryErr.status === 429 || primaryErr.status === 404 || primaryErr.status >= 500)
      ) {
        console.warn(
          `Primary model ${primaryModel} failed (${primaryErr.message}). Initiating Bifrost fallback to ${serverConfig.bifrostFallbackModel}...`
        );
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
    if (requestTimeout <= 0) throw new Error('The 90-second run deadline was reached. No further model request was sent.');
    if (budget && budget.callCount >= serverConfig.maxModelCallsPerRun - (budget.reservedModelCalls || 0)) {
      throw new Error('Model call budget exceeded. No additional model request was sent.');
    }
    const remainingTokens = serverConfig.maxTokensPerRun - (budget?.totalTokensUsed || 0);
    if (remainingTokens <= 0) throw new Error('Token budget exhausted. No additional model request was sent.');
    if (budget?.usage && budget.usage.estimatedCost >= serverConfig.maxCostPerRunUsd) {
      throw new Error('Estimated cost budget exhausted. Actual billing depends on gateway pricing.');
    }
    if (budget) budget.callCount++;
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
      max_tokens: Math.min(options.maxTokens ?? 1500, remainingTokens)
    };

    if (options.responseFormat === 'json_object') {
      bodyPayload.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeout);

    try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      throw Object.assign(new Error(`Bifrost model request failed with status ${resp.status}. Check gateway credentials, model configuration and quota.`),
        { status: resp.status });
    }

    const data = await resp.json();
    const latencyMs = Date.now() - startTime;

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Bifrost returned no valid completion content.');
    }
    const rawUsage: BifrostUsageRaw = data.usage || {};

    const validCount = (value: unknown): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    const promptTokens = validCount(rawUsage.prompt_tokens) ? rawUsage.prompt_tokens : 0;
    const completionTokens = validCount(rawUsage.completion_tokens) ? rawUsage.completion_tokens : 0;
    const totalTokens = Math.max(validCount(rawUsage.total_tokens) ? rawUsage.total_tokens : 0,
      promptTokens + completionTokens);

    // Conservative standard estimate: $0.15/1M prompt, $0.60/1M completion
    const estimatedCost = (promptTokens * 0.00000015) + (completionTokens * 0.0000006);

    const usage: MeasuredTokenUsage = {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
      estimatedCost: Number(estimatedCost.toFixed(6)),
      currency: 'USD',
      isMeasured: validCount(rawUsage.prompt_tokens) && validCount(rawUsage.completion_tokens),
      model,
      provider: data.model || 'bifrost-gateway',
      latencyMs,
      fallbackUsed: isFallback,
      fallbackModel: isFallback ? model : undefined
    };
    if (budget?.usage) recordUsage(budget as RunBudget, usage);

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
            throw new Error('Bifrost model response could not be parsed as valid JSON.');
          }
        } else {
          throw new Error('Bifrost model failed to produce required JSON schema output.');
        }
      }
    }

    return {
      content,
      usage,
      rawJson
    };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const bifrostService = new BifrostService();
