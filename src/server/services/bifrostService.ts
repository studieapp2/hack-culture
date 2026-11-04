import { serverConfig, IntegrationHealth } from '../config';
import { MeasuredTokenUsage } from '../types';

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
    return Boolean(this.baseUrl && this.baseUrl.startsWith('http'));
  }

  public async checkHealth(): Promise<IntegrationHealth> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        status: 'missing_configuration',
        details: 'BIFROST_BASE_URL is not set in server environment.'
      };
    }

    try {
      const cleanBaseUrl = this.baseUrl!.replace(/\/+$/, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

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

      if (!resp.ok && resp.status !== 404) {
        return {
          configured: true,
          status: 'provider_error',
          error: `Bifrost gateway returned HTTP ${resp.status}`
        };
      }

      return {
        configured: true,
        status: 'connected_and_verified',
        details: `Connected to Bifrost gateway at ${cleanBaseUrl}`
      };
    } catch (err: any) {
      return {
        configured: true,
        status: 'disconnected',
        error: `Could not reach Bifrost gateway: ${err?.message || 'Connection refused'}`
      };
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
      if (options.runBudget.callCount >= serverConfig.maxModelCallsPerRun) {
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
        serverConfig.bifrostFallbackModel !== primaryModel
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
      max_tokens: options.maxTokens ?? 1500
    };

    if (options.responseFormat === 'json_object') {
      bodyPayload.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), serverConfig.requestTimeoutMs);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Bifrost model request to '${model}' failed with status ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const latencyMs = Date.now() - startTime;

    const content = data.choices?.[0]?.message?.content || '';
    const rawUsage: BifrostUsageRaw = data.usage || {};

    const promptTokens = rawUsage.prompt_tokens || 0;
    const completionTokens = rawUsage.completion_tokens || 0;
    const totalTokens = rawUsage.total_tokens || promptTokens + completionTokens;

    // Conservative standard estimate: $0.15/1M prompt, $0.60/1M completion
    const estimatedCost = (promptTokens * 0.00000015) + (completionTokens * 0.0000006);

    const usage: MeasuredTokenUsage = {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
      estimatedCost: Number(estimatedCost.toFixed(6)),
      currency: 'USD',
      isMeasured: Boolean(data.usage),
      model,
      provider: data.model || 'bifrost-gateway',
      latencyMs,
      fallbackUsed: isFallback,
      fallbackModel: isFallback ? model : undefined
    };

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
  }
}

export const bifrostService = new BifrostService();
